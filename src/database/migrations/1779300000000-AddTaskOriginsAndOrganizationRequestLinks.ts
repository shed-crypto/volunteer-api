import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskOriginsAndOrganizationRequestLinks1779300000000
  implements MigrationInterface
{
  name = 'AddTaskOriginsAndOrganizationRequestLinks1779300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tasks_origin_enum') THEN CREATE TYPE "public"."tasks_origin_enum" AS ENUM('requester', 'coordinator', 'admin', 'organization', 'system'); END IF; END $$`,
    );

    await queryRunner.query(
      `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "created_by_user_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "origin" "public"."tasks_origin_enum" NOT NULL DEFAULT 'requester'`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "is_auto_generated" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "managing_organization_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "cancelled_by_user_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "cancel_reason" text`,
    );

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_tasks_created_by_user') THEN
          ALTER TABLE "tasks"
          ADD CONSTRAINT "FK_tasks_created_by_user"
          FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
          ON DELETE SET NULL ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_requests_managing_organization') THEN
          ALTER TABLE "requests"
          ADD CONSTRAINT "FK_requests_managing_organization"
          FOREIGN KEY ("managing_organization_id") REFERENCES "organizations"("id")
          ON DELETE SET NULL ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_requests_cancelled_by_user') THEN
          ALTER TABLE "requests"
          ADD CONSTRAINT "FK_requests_cancelled_by_user"
          FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id")
          ON DELETE SET NULL ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UQ_task_delegations_task_org') THEN
          ALTER TABLE "task_delegations"
          ADD CONSTRAINT "UQ_task_delegations_task_org"
          UNIQUE ("task_id", "organization_id");
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "task_delegations" DROP CONSTRAINT IF EXISTS "UQ_task_delegations_task_org"`,
    );
    await queryRunner.query(
      `ALTER TABLE "requests" DROP CONSTRAINT IF EXISTS "FK_requests_managing_organization"`,
    );
    await queryRunner.query(
      `ALTER TABLE "requests" DROP CONSTRAINT IF EXISTS "FK_requests_cancelled_by_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "FK_tasks_created_by_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "requests" DROP COLUMN IF EXISTS "cancel_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "requests" DROP COLUMN IF EXISTS "cancelled_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "requests" DROP COLUMN IF EXISTS "cancelled_by_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "requests" DROP COLUMN IF EXISTS "managing_organization_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN IF EXISTS "is_auto_generated"`,
    );
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "origin"`);
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN IF EXISTS "created_by_user_id"`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."tasks_origin_enum"`);
  }
}
