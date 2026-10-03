import type { Decision, EvaluateRequest } from './types';
interface Scenario { id: string; label: string; expected: Decision; note: string; request: EvaluateRequest }
const portfolio: EvaluateRequest = {
  user: 'analyst_42', role: 'ANALYST', action: 'read', resource: 'portfolio/current_positions',
  classification: 'RESTRICTED', destination: 'INTERNAL',
};
// These are proposed inputs, never simulated security outcomes.
export const scenarios: Scenario[] = [
  { id: 'normal', label: 'Normal low-risk request', expected: 'ALLOW', note: 'Confirm this public resource with the backend policy catalog.', request: { ...portfolio, resource: 'research/public_summary', classification: 'PUBLIC' } },
  { id: 'analyst', label: 'Analyst · restricted portfolio', expected: 'BLOCK', note: 'Shared contract acceptance case.', request: portfolio },
  { id: 'manager', label: 'Portfolio manager · same resource', expected: 'ALLOW', note: 'Same data, different role. The backend decides.', request: { ...portfolio, user: 'manager_7', role: 'PORTFOLIO_MANAGER' } },
  { id: 'external', label: 'Restricted data · external destination', expected: 'BLOCK', note: 'Confirm EXTERNAL is the destination token used by the backend.', request: { ...portfolio, user: 'manager_7', role: 'PORTFOLIO_MANAGER', destination: 'EXTERNAL' } },
  { id: 'tool', label: 'Dangerous proposed tool action', expected: 'BLOCK', note: 'Evaluation only. This dashboard has no tool execution path. Tool schema requires backend confirmation.', request: { ...portfolio, resource: 'tools/shell', classification: 'INTERNAL', action: 'execute', tool: 'shell', tool_arguments: { command: 'rm -rf /' } } },
];
