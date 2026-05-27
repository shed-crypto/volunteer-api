import { MigrationInterface, QueryRunner } from "typeorm";

export class AddWithdrawnToTaskAssignmentsStatus20260527180000 implements MigrationInterface {
    name = 'AddWithdrawnToTaskAssignmentsStatus20260527180000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Rename the old enum type to keep a backup
        await queryRunner.query(`
            ALTER TYPE "task_assignments_status_enum" RENAME TO "task_assignments_status_enum_old"
        `);

        // Create a new enum type with the added 'withdrawn' value
        await queryRunner.query(`
            CREATE TYPE "task_assignments_status_enum" AS ENUM ('assigned', 'en_route', 'on_site', 'completed', 'withdrawn')
        `);

        // Update the status column to use the new enum type
        await queryRunner.query(`
            ALTER TABLE "task_assignments"
            ALTER COLUMN "status" TYPE "task_assignments_status_enum"
            USING "status"::text::"task_assignments_status_enum"
        `);

        // Drop the old enum type
        await queryRunner.query(`DROP TYPE "task_assignments_status_enum_old"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Rename the current enum type
        await queryRunner.query(`
            ALTER TYPE "task_assignments_status_enum" RENAME TO "task_assignments_status_enum_new"
        `);

        // Recreate the original enum without 'withdrawn'
        await queryRunner.query(`
            CREATE TYPE "task_assignments_status_enum" AS ENUM ('assigned', 'en_route', 'on_site', 'completed')
        `);

        // Revert the status column
        await queryRunner.query(`
            ALTER TABLE "task_assignments"
            ALTER COLUMN "status" TYPE "task_assignments_status_enum"
            USING "status"::text::"task_assignments_status_enum"
        `);

        // Drop the new enum type
        await queryRunner.query(`DROP TYPE "task_assignments_status_enum_new"`);
    }
}
