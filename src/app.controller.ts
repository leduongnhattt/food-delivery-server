import { Controller, Get } from '@nestjs/common';
import { AppService } from '@src/app.service';
import { PrismaService } from '@infra/prisma/prisma.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  async health(): Promise<{ status: string; db: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'connected' };
    } catch {
      return { status: 'ok', db: 'disconnected' };
    }
  }

  /**
   * Kiểm tra kết nối DB: gọi GET /api/db-check để xem có kết nối được MySQL không.
   */
  @Get('db-check')
  async dbCheck(): Promise<{
    success: boolean;
    message: string;
    db?: string;
    error?: string;
  }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const version = await this.prisma.$queryRaw<Array<{ VERSION: string }>>`SELECT VERSION() AS VERSION`;
      const dbVersion = version?.[0]?.VERSION ?? 'unknown';
      return {
        success: true,
        message: 'Kết nối database thành công.',
        db: dbVersion,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: 'Không kết nối được database.',
        error: message,
      };
    }
  }

  /**
   * Lấy danh sách toàn bộ bảng trong database hiện tại.
   * GET /api/db-check/tables
   */
  @Get('db-check/tables')
  async dbCheckTables(): Promise<{
    success: boolean;
    database?: string;
    tables?: Array<{ tableName: string; tableRows?: string; comment?: string }>;
    error?: string;
  }> {
    try {
      const dbName = await this.prisma.$queryRaw<Array<{ name: string }>>`SELECT DATABASE() AS name`;
      const currentDb = dbName?.[0]?.name ?? '';

      const rows = await this.prisma.$queryRaw<
        Array<{ TABLE_NAME: string; TABLE_ROWS: string | null; TABLE_COMMENT: string | null }>
      >`
        SELECT TABLE_NAME, TABLE_ROWS, TABLE_COMMENT
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
        ORDER BY TABLE_NAME
      `;

      return {
        success: true,
        database: currentDb,
        tables: rows.map((row) => ({
          tableName: row.TABLE_NAME,
          tableRows: row.TABLE_ROWS != null ? String(row.TABLE_ROWS) : undefined,
          comment: row.TABLE_COMMENT || undefined,
        })),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: message,
      };
    }
  }
}
