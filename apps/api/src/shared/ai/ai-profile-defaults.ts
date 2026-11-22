/** Defaults must match ai_profiles.model_settings and ai_profiles.schedule in @nexter/db. */
export const DEFAULT_AI_MODEL_SETTINGS = {
  model: 'deepseek-flash',
  temperature: 0.2,
  maxTokens: 2000,
  timeoutSeconds: 60,
};

export const DEFAULT_AI_SCHEDULE = {
  weeklyReview: true,
  weeklyDay: 0,
  weeklyHour: 3,
  events: true,
};
