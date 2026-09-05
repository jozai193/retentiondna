export type WorkflowPhase = 'ready' | 'analyzing' | 'repaired';
export type CutMode = 'original' | 'better';

export type WorkflowState = {
  phase: WorkflowPhase;
  progress: number;
  error: string;
  cutMode: CutMode;
};

export type WorkflowAction =
  | { type: 'ANALYZE_START' }
  | { type: 'ANALYZE_PROGRESS'; progress: number }
  | { type: 'ANALYZE_SUCCESS' }
  | { type: 'ANALYZE_FAILURE'; message: string }
  | { type: 'RESET' }
  | { type: 'STAGE_REPAIR' }
  | { type: 'SET_CUT'; cutMode: CutMode }
  | { type: 'CLEAR_ERROR' };

export const initialWorkflowState: WorkflowState = {
  phase: 'ready',
  progress: 0,
  error: '',
  cutMode: 'original',
};

export function workflowReducer(
  state: WorkflowState,
  action: WorkflowAction,
): WorkflowState {
  switch (action.type) {
    case 'ANALYZE_START':
      return {
        phase: 'analyzing',
        progress: 14,
        error: '',
        cutMode: 'original',
      };
    case 'ANALYZE_PROGRESS':
      return {
        ...state,
        progress: Math.max(0, Math.min(100, action.progress)),
      };
    case 'ANALYZE_SUCCESS':
    case 'RESET':
      return initialWorkflowState;
    case 'ANALYZE_FAILURE':
      return {
        phase: 'ready',
        progress: 0,
        error: action.message,
        cutMode: 'original',
      };
    case 'STAGE_REPAIR':
      return { ...state, phase: 'repaired', error: '', cutMode: 'better' };
    case 'SET_CUT':
      return {
        ...state,
        cutMode:
          action.cutMode === 'better' && state.phase !== 'repaired'
            ? 'original'
            : action.cutMode,
      };
    case 'CLEAR_ERROR':
      return { ...state, error: '' };
  }
}
