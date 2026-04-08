import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';
import { User } from '@modules/users/entities/user.entity';

export interface JwtPayload {
  sub: string;   // user UUID
  email: string;
  role: string;
  clearance: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'dev_secret',
    });
  }

  async validate(payload: JwtPayload): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
      select: ['id', 'email', 'fullName', 'systemRole', 'clearanceLevel', 'isBlocked'],
    });

    if (!user) {
      throw new UnauthorizedException('Користувача не знайдено');
    }

    if (user.isBlocked) {
      throw new UnauthorizedException('Обліковий запис заблоковано');
    }

    return user;
  }
}
