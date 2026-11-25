// SPECTER-DIAGNOSTIC-ONLY
import { describe, expect, it } from 'vitest';
import {
  DIAGNOSTIC_MARKER,
  cellValidity,
  type CapabilityCell,
  type CapabilityScope,
  type CapabilityState,
  type Credential,
  type Evidence,
} from './model';

const SCOPES: CapabilityScope[] = ['app-owned', 'user-owned', 'other-app', 'bot', 'external-cli'];
const STATES: CapabilityState[] = ['ALLOWED', 'DENIED', 'UNSUPPORTED', 'UNTESTED'];

const evidence = (credential: Credential): Evidence => ({
  credential,
  at: '2026-11-09T00:00:00Z',
  ref: 'run.log#1',
  excerpt: 'text',
});

const cell = (scope: CapabilityScope, state: CapabilityState, items: Evidence[]): CapabilityCell => ({
  key: 'k',
  question: 'q',
  scope,
  state,
  evidence: items,
});

describe('cellValidity', () => {
  for (const scope of SCOPES) {
    describe(`scope ${scope}`, () => {
      it('accepts ALLOWED with APP-TOKEN evidence', () => {
        expect(cellValidity(cell(scope, 'ALLOWED', [evidence('APP-TOKEN')]))).toBe('valid');
      });

      it('accepts ALLOWED when any item is APP-TOKEN', () => {
        expect(cellValidity(cell(scope, 'ALLOWED', [evidence('OWNER-SESSION'), evidence('APP-TOKEN')]))).toBe('valid');
      });

      it('rejects ALLOWED resting on OWNER-SESSION evidence only', () => {
        expect(cellValidity(cell(scope, 'ALLOWED', [evidence('OWNER-SESSION')]))).toBe('invalid-evidence');
      });

      it('rejects ALLOWED with no evidence', () => {
        expect(cellValidity(cell(scope, 'ALLOWED', []))).toBe('invalid-evidence');
      });

      it('never invalidates a state other than ALLOWED', () => {
        for (const state of STATES.filter((candidate) => candidate !== 'ALLOWED')) {
          expect(cellValidity(cell(scope, state, [evidence('OWNER-SESSION')]))).toBe('valid');
          expect(cellValidity(cell(scope, state, []))).toBe('valid');
        }
      });
    });
  }

  it('has no host scope', () => {
    // @ts-expect-error 'host' is a HostFact concern, not a CapabilityScope (FD-1)
    const scope: CapabilityScope = 'host';
    expect(SCOPES).not.toContain(scope);
  });
});

describe('DIAGNOSTIC_MARKER', () => {
  it('is the literal the exclusion check scans for', () => {
    expect(DIAGNOSTIC_MARKER).toBe('SPECTER-DIAGNOSTIC-ONLY');
  });
});
