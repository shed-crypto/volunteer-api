import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMediaUrlsToRequest20260506150900 implements MigrationInterface {
    name = 'AddMediaUrlsToRequest20260506150900'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Drop old simple-array column if exists
        await queryRunner.query(`ALTER TABLE "requests" DROP COLUMN IF EXISTS "media_urls"`);
        // Add new jsonb column
        await queryRunner.query(`ALTER TABLE "requests" ADD COLUMN "media_urls" jsonb DEFAULT '[]'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "requests" DROP COLUMN IF EXISTS "media_urls"`);
        await queryRunner.query(`ALTER TABLE "requests" ADD COLUMN "media_urls" text[]`);
    }
}
