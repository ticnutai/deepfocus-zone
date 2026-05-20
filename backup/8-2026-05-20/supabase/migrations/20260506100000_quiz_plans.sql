-- Quiz plans (tests/exams plans) + attempts history, stored as JSONB on user_settings
-- Mirrors the pattern used for general_plan_reviews / shas plans
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS quiz_plans jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS quiz_attempts jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.user_settings.quiz_plans IS
  'Per-user quiz/exam plans: [{id,name,scopes:[{path,includeDescendants}],questionTypes,perCategoryTypes,perSession:{modes,fixedCount,randomMin,randomMax},selection:{random,uncoveredFirst,weakFirst,weighted},duration:{days?,endDate?,openEnded},frequency:{daily?,bigExamDates[]},scheduling:{manual,notifications,quotaPerWeek?},isActive,createdAt}]';

COMMENT ON COLUMN public.user_settings.quiz_attempts IS
  'Per-user quiz attempts history: [{id,planId,startedAt,finishedAt,total,correct,wrongCardIds[],score}]';
