-- Prevent concurrent execution of two runs for the same Mission stage.
-- Completed runs remain available for revisions and audit history.
CREATE UNIQUE INDEX IF NOT EXISTS sandy_mission_runs_single_active_stage
ON public.sandy_mission_runs(mission_task_id, stage)
WHERE state IN ('queued','running');
