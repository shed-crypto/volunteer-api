import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOrganizationsEnhancements1777642973185 implements MigrationInterface {
    name = 'AddOrganizationsEnhancements1777642973185'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Enums creation (IF NOT EXISTS)
        await queryRunner.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'organization_join_requests_status_enum') THEN CREATE TYPE "public"."organization_join_requests_status_enum" AS ENUM('pending', 'approved', 'rejected'); END IF; END $$`);
        await queryRunner.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'organization_settings_allowed_member_roles_enum') THEN CREATE TYPE "public"."organization_settings_allowed_member_roles_enum" AS ENUM('leader', 'coordinator', 'member'); END IF; END $$`);

        // Create organization_settings table (IF NOT EXISTS)
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "organization_settings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "organization_id" uuid NOT NULL, "allow_public_join" boolean NOT NULL DEFAULT false, "require_join_approval" boolean NOT NULL DEFAULT true, "member_invite_allowed" boolean NOT NULL DEFAULT true, "subgroup_creation_allowed" boolean NOT NULL DEFAULT true, "media_upload_allowed" boolean NOT NULL DEFAULT true, "allowed_member_roles" "public"."organization_settings_allowed_member_roles_enum" array NOT NULL DEFAULT '{member,coordinator,leader}', CONSTRAINT "REL_9f270928e46949392e210167c6" UNIQUE ("organization_id"), CONSTRAINT "PK_26a31f7435f492a348e9a26372b" PRIMARY KEY ("id"))`);

        // Create organization_join_requests table (IF NOT EXISTS)
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "organization_join_requests" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "organization_id" uuid NOT NULL, "user_id" uuid NOT NULL, "message" text, "status" "public"."organization_join_requests_status_enum" NOT NULL DEFAULT 'pending', "reviewed_by" uuid, "reviewComment" text, "reviewed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_c6a31f7435f492a348e9a26372c" PRIMARY KEY ("id"))`);

        // Add banner_url to organizations (IF NOT EXISTS)
        await queryRunner.query(`ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "banner_url" character varying(1000)`);

        // Add foreign keys
        await queryRunner.query(`ALTER TABLE "organization_settings" ADD CONSTRAINT "FK_9f270928e46949392e210167c6b" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "organization_join_requests" ADD CONSTRAINT "FK_c6a31f7435f492a348e9a26372d" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "organization_join_requests" ADD CONSTRAINT "FK_c6a31f7435f492a348e9a26372e" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "organization_join_requests" ADD CONSTRAINT "FK_c6a31f7435f492a348e9a26372f" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "organization_join_requests" DROP CONSTRAINT "FK_c6a31f7435f492a348e9a26372f"`);
        await queryRunner.query(`ALTER TABLE "organization_join_requests" DROP CONSTRAINT "FK_c6a31f7435f492a348e9a26372e"`);
        await queryRunner.query(`ALTER TABLE "organization_join_requests" DROP CONSTRAINT "FK_c6a31f7435f492a348e9a26372d"`);
        await queryRunner.query(`ALTER TABLE "organization_settings" DROP CONSTRAINT "FK_9f270928e46949392e210167c6b"`);
        await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "banner_url"`);
        await queryRunner.query(`DROP TABLE "organization_join_requests"`);
        await queryRunner.query(`DROP TABLE "organization_settings"`);
        await queryRunner.query(`DROP TYPE "public"."organization_settings_allowed_member_roles_enum"`);
        await queryRunner.query(`DROP TYPE "public"."organization_join_requests_status_enum"`);
    }
}