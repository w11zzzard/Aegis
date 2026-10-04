import type { Decision, EvaluateRequest } from './types';
interface Scenario { id: string; label: string; expected: Decision; expectedPolicy: string; note: string; request: EvaluateRequest }
const portfolio: EvaluateRequest = {
  user: 'analyst_42', role: 'ANALYST', action: 'read', resource: 'portfolio/current_positions',
  classification: 'RESTRICTED', destination: 'INTERNAL',
};
// These are proposed inputs, never simulated security outcomes.
export const scenarios: Scenario[] = [
  { id: 'normal', label: 'Public market summary', expected: 'ALLOW', expectedPolicy: 'market_public', note: 'Registered public read; policy and decision are both checked.', request: { ...portfolio, resource: 'public/market_summary', classification: 'PUBLIC' } },
  { id: 'analyst', label: 'Analyst · restricted portfolio', expected: 'BLOCK', expectedPolicy: 'portfolio_restricted', note: 'The restricted-resource guard must explain the block.', request: portfolio },
  { id: 'manager', label: 'Portfolio manager · same resource', expected: 'ALLOW', expectedPolicy: 'portfolio_restricted', note: 'Registered manager_1 with the authorized role.', request: { ...portfolio, user: 'manager_1', role: 'PORTFOLIO_MANAGER' } },
  { id: 'external', label: 'Restricted data · external destination', expected: 'BLOCK', expectedPolicy: 'external_exfiltration', note: 'Authorized manager; the destination guard must block.', request: { ...portfolio, user: 'manager_1', role: 'PORTFOLIO_MANAGER', destination: 'EXTERNAL' } },
  { id: 'tool', label: 'Unsafe tool proposal', expected: 'BLOCK', expectedPolicy: 'tool_guard', note: 'Valid manager read plus synthetic shell arguments. Evaluation only; no command executes.', request: { ...portfolio, user: 'manager_1', role: 'PORTFOLIO_MANAGER', tool: 'shell', tool_arguments: { command: 'echo AEGIS_SYNTHETIC_UNSAFE_PROPOSAL' } } },
  { id: 'redact', label: 'Synthetic secret · redacted output', expected: 'REDACT', expectedPolicy: 'output_secrets', note: 'The backend screens synthetic output; the dashboard displays decision metadata only.', request: { ...portfolio, resource: 'public/market_summary', classification: 'PUBLIC', output: 'sk-AEGISSYNTHETIC123456' } },
  { id: 'throttle', label: 'Budget limit', expected: 'THROTTLE', expectedPolicy: 'budget', note: 'Conservative units exceed the configured budget.', request: { ...portfolio, resource: 'public/market_summary', classification: 'PUBLIC', estimated_tokens: 1000000 } },
];
