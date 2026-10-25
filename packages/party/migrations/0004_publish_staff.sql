CREATE VIEW party_staff_read AS
SELECT from_id AS person_id, to_id AS organisation_id
FROM party_relationship
WHERE from_kind = 'person' AND to_kind = 'organisation' AND kind = 'staff';
