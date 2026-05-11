DELETE FROM work_galleries
WHERE work_id IN (SELECT id FROM works WHERE deleted_at IS NOT NULL);

UPDATE galleries
SET cover_work_id = NULL,
    cover_version_id = NULL
WHERE cover_work_id IN (SELECT id FROM works WHERE deleted_at IS NOT NULL)
   OR cover_version_id IN (
     SELECT work_versions.id
     FROM work_versions
     JOIN works ON works.id = work_versions.work_id
     WHERE works.deleted_at IS NOT NULL
   );
