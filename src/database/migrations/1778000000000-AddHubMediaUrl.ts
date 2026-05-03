import { MigrationInterface, QueryRunner } from "typeorm";

export class AddHubMediaUrl1778000000000 implements MigrationInterface {
  name = 'AddHubMediaUrl1778000000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "hubs" ADD COLUMN IF NOT EXISTS "media_url" character varying(1000)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "hubs" DROP COLUMN IF EXISTS "media_url"`);
  }
}
