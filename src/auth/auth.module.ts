import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtModule } from '@nestjs/jwt';
import {envs}  from '../config/envs';

@Module({
  controllers: [AuthController],
  providers: [AuthService],
  imports: [
    JwtModule.register({
      secret: envs.jwtSecret || 'default_secret',
      global: true,
      signOptions: { expiresIn: '1h' },
    }),
  ],
})
export class AuthModule { }
