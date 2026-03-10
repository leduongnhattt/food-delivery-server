export interface AppConfig {
  port: number;
}

export const appConfig = (): AppConfig => {
  const portFromEnv = process.env.PORT;
  const port = portFromEnv ? Number(portFromEnv) || 3001 : 3001;
  return { port };
};

