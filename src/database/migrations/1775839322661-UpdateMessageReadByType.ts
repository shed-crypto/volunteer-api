import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateMessageReadByType1775839322661 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "messages" ALTER COLUMN "read_by" TYPE text[] USING "read_by"::text[]`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "messages" ALTER COLUMN "read_by" TYPE text USING "read_by"::text`);
    }

}
