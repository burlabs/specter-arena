from __future__ import annotations

import asyncio
import importlib
import logging
import os
from collections.abc import Mapping
from types import ModuleType
from typing import Any

_LOG = logging.getLogger("specter_arena.store_runtime")


class StoreRuntime:
    """Holds the open store and its latest status for the backend's lifetime.

    The store package (and with it `sqlite3`) is imported lazily, inside `open()` and
    `refresh()`, and never when `probe_on` is set: importing `backend.app` touches no disk and
    the diagnostic probe never shares a process with product state. Every failure becomes a
    status through the store's own `status_for_error`, which maps by exception type only, so no
    path or message can reach a response. `open()` never raises.
    """

    def __init__(self, *, probe_on: bool, environ: Mapping[str, str] | None = None) -> None:
        self.probe_on = probe_on
        self._environ = os.environ if environ is None else environ
        self._store: Any | None = None
        self._status: Any | None = None

    def _store_module(self) -> ModuleType:
        return importlib.import_module(".store", __package__)

    async def open(self) -> None:
        if self.probe_on:
            return
        store = self._store_module()
        try:
            data_dir = store.resolve_data_dir(self._environ)
            if data_dir is None:
                self._status = store.unconfigured_status()
                return
            self._status = store.migrating_status()
            opened = await asyncio.to_thread(store.open_store, data_dir)
            self._store = opened
            self._status = await asyncio.to_thread(opened.status)
        except Exception as error:
            self._status = store.status_for_error(error)
            _LOG.warning("store open failed: %s", type(error).__name__)

    async def refresh(self) -> Any:
        """The current store status, read again from the open store when there is one."""
        store = self._store_module()
        try:
            if self._store is not None:
                self._status = await asyncio.to_thread(self._store.status)
            elif self._status is None:
                self._status = store.unconfigured_status()
        except Exception as error:
            self._status = store.status_for_error(error)
        return self._status

    async def close(self) -> None:
        if self._store is None:
            return
        opened, self._store = self._store, None
        await asyncio.to_thread(opened.close)
