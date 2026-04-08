import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from '@modules/users/entities/user.entity';

/**
 * Декоратор для отримання поточного авторизованого користувача з request.
 *
 * Використання:
 *   @Get('profile')
 *   @UseGuards(JwtAuthGuard)
 *   getProfile(@CurrentUser() user: User) { ... }
 *
 *   // Або лише конкретне поле:
 *   getProfile(@CurrentUser('id') userId: string) { ... }
 */
export const CurrentUser = createParamDecorator(
  (field: keyof User | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user: User = request.user;
    return field ? user?.[field] : user;
  },
);
