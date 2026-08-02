import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { LoginUserDto, RegisterUserDto } from './dto';
import { PrismaClient } from '@prisma/client';
import { RpcException } from '@nestjs/microservices/exceptions/rpc-exception';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { JwtPayload } from './interfaces/jwt-payload';

@Injectable()
export class AuthService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger('AuthService');

  constructor(private readonly jwtService: JwtService) {
    super();
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Connected to MongoDB');
  }

  // TODO: persistir en Mongo (Prisma) y firmar el JWT. Por ahora sólo devuelven el
  // payload, para poder verificar el cableado NATS extremo a extremo.
  async registerUser(registerUserDto: RegisterUserDto) {
    try {
      const user = await this.user.findUnique({
        where: { email: registerUserDto.email },
      });
      if (user) {
        throw new RpcException({ status: 400, message: 'User already exists' });
      }
      const userCreated = await this.user.create({
        data: {
          email: registerUserDto.email,
          name: registerUserDto.name,
          password: bcrypt.hashSync(registerUserDto.password, 10),
        },
      });
      this.logger.log(`User registered: ${userCreated.email}`);
      const { password: _, ...userWithoutPassword } = userCreated;
      return { user: userWithoutPassword, token: await this.signJwt(userWithoutPassword) };
    } catch (error) {
      if (error instanceof RpcException) throw error;
      throw new RpcException({ status: 500, message: 'User registration failed' });
    }
  }

  async loginUser(loginUserDto: LoginUserDto) {
    try {
      const user = await this.user.findUnique({
        where: { email: loginUserDto.email },
      });
      if (!user) {
        throw new RpcException({ status: 400, message: 'Invalid credentials' });
      }
      const isPasswordMatch = bcrypt.compareSync(loginUserDto.password, user.password);
      if (!isPasswordMatch) {
        throw new RpcException({ status: 400, message: 'Invalid credentials' });
      }
      this.logger.log(`User logged in: ${user.email}`);
      const { password: _, ...userWithoutPassword } = user;
      return { user: userWithoutPassword, token: await this.signJwt(userWithoutPassword) };
    } catch (error) {
      // Las RpcException de arriba ya traen su status y su mensaje: hay que dejarlas
      // pasar, si no el catch las reemplaza por un genérico 'User login failed'.
      if (error instanceof RpcException) throw error;
      throw new RpcException({ status: 500, message: 'User login failed' });
    }
  }

  async verifyUser(token: string) {
    try {
      // iat/exp los pone jsonwebtoken al firmar; hay que sacarlos antes de volver
      // a firmar o `sign()` rompe por chocar con signOptions.expiresIn.
      const { iat: _iat, exp: _exp, ...user } = this.jwtService.verify<
        JwtPayload & { iat: number; exp: number }
      >(token);
      this.logger.log(`Token verified: ${user.email}`);
      // Token nuevo, no el que vino: la sesión activa se renueva sola.
      return { user, token: await this.signJwt(user) };
    } catch {
      // `status`, no `statusCode`: el filtro global del gateway sólo entiende esa
      // clave, con la otra lo degrada a 400.
      throw new RpcException({ status: 401, message: 'Invalid token' });
    }
  }

  async signJwt(payload: JwtPayload): Promise<string> {
    return this.jwtService.sign(payload);
  }
}
