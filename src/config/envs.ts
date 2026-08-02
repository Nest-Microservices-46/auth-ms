import "dotenv/config";
import * as Joi from "joi";

interface EnvVars {
    PORT: number;
    NATS_SERVERS: string[];
    JWT_SECRET: string;
}

const envsSchema = Joi.object({
    PORT: Joi.number().required(),
    NATS_SERVERS: Joi.array().items(Joi.string()).required(),
    JWT_SECRET: Joi.string().required(),
}).unknown(true);

// NATS_SERVERS viaja como string separado por comas: se parte antes de validar
// para que el schema vea el array que espera.
const { error, value } = envsSchema.validate({
    ...process.env,
    NATS_SERVERS: process.env.NATS_SERVERS?.split(','),
});

if (error) {
    throw new Error("Invalid environment variables");
}

const envVars: EnvVars = value;

export const envs = {
    port: envVars.PORT,
    natsServers: envVars.NATS_SERVERS,
    jwtSecret: envVars.JWT_SECRET,
}
