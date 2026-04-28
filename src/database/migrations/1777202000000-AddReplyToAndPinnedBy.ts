import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddReplyToAndPinnedBy1777202000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Додаємо колонку reply_to до таблиці messages
    const messageTable = await queryRunner.getTable('messages');
    const hasReplyTo = messageTable?.findColumnByName('reply_to');
    if (!hasReplyTo) {
      await queryRunner.addColumn(
        'messages',
        new TableColumn({
          name: 'reply_to',
          type: 'uuid',
          isNullable: true,
          default: null,
        }),
      );
    }

    // Додаємо колонку pinned_by до таблиці chats
    const chatTable = await queryRunner.getTable('chats');
    const hasPinnedBy = chatTable?.findColumnByName('pinned_by');
    if (!hasPinnedBy) {
      await queryRunner.addColumn(
        'chats',
        new TableColumn({
          name: 'pinned_by',
          type: 'text',
          isNullable: true,
          default: null,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('messages', 'reply_to');
    await queryRunner.dropColumn('chats', 'pinned_by');
  }
}