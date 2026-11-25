from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager

from .errors import StoreError, StoreUnavailable


@contextmanager
def translate_errors() -> Iterator[None]:
    """Driver errors never escape the store; they become `StoreUnavailable` with the cause."""
    try:
        yield
    except StoreError:
        raise
    except sqlite3.Error as error:
        raise StoreUnavailable from error
