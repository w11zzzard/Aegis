import { describe, expect, it } from 'vitest';
import { ContractError, normalizeEvent, normalizeEvents, normalizeEvaluation } from './adapter';
import { event, result } from './test-fixtures';

describe('sensitive response fields must fail visibly', () => {
  it.each(['prompt', 'output', 'source', 'tool', 'tool_arguments', 'Authorization', 'access_token', 'API-Key', 'password', 'stack', 'traceback'])('rejects unexpected sensitive %s fields instead of silently accepting a sanitized-looking response', key => {
    const content = { [key]: 'SYNTHETIC_SENSITIVE_PAYLOAD' };
    expect(() => normalizeEvent({ ...event, ...content })).toThrow(ContractError);
    expect(() => normalizeEvaluation({ ...result, ...content })).toThrow(ContractError);
    expect(() => normalizeEvents({ events: [event], ...content })).toThrow(ContractError);
    expect(() => normalizeEvent({ ...event, unexpected: { nested: content } })).toThrow(ContractError);
  });
  it.each(['BLOCK', 'REQUIRE_APPROVAL', 'THROTTLE'])('rejects sanitized_output attached to %s', decision => {
    expect(() => normalizeEvaluation({ ...result, decision, sanitized_output: 'SYNTHETIC_CONTENT' })).toThrow(ContractError);
  });
  it('rejects output in an audit but preserves permitted evaluation compatibility without displaying content', () => {
    expect(() => normalizeEvent({ ...event, sanitized_output: 'SYNTHETIC_CONTENT' })).toThrow(ContractError);
    for (const decision of ['ALLOW', 'REDACT']) expect(normalizeEvaluation({ ...result, decision, sanitized_output: '[REDACTED]' })).toEqual({ ...result, decision });
    expect(normalizeEvent({ ...event, evidence_class: 'protected', harmless: { code: 1 } })).toEqual(event);
  });
  it('bounds traversal of unexpected nested metadata without dropping a valid positive control', () => {
    let excessive: unknown = 'benign';
    for (let index = 0; index < 18; index++) excessive = { nested: excessive };
    expect(() => normalizeEvent({ ...event, future: excessive })).toThrow(ContractError);
    expect(() => normalizeEvaluation({ ...result, future: Array(10001).fill(0) })).toThrow(ContractError);
    expect(normalizeEvents({ events: Array.from({ length: 100 }, () => ({ ...event, evidence_class: 'protected' })) })).toHaveLength(100);
  });
  it('rejects aliases and misplaced or malformed sanitized_output while keeping legitimate output omitted', () => {
    expect(() => normalizeEvaluation({ ...result, decision: 'ALLOW', 'Sanitized-Output': 'SYNTHETIC' })).toThrow(ContractError);
    expect(() => normalizeEvaluation({ ...result, decision: 'ALLOW', sanitized_output: { value: 'SYNTHETIC' } })).toThrow(ContractError);
    expect(() => normalizeEvaluation({ ...result, decision: 'ALLOW', metadata: { sanitized_output: 'SYNTHETIC' } })).toThrow(ContractError);
  });
});
