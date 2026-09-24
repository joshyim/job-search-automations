import { z } from 'zod';
export declare const ConfigSchema: z.ZodObject<{
    version: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    mode: z.ZodEnum<["local", "neon"]>;
    databasePath: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    resumePath: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    workflowDataPath: z.ZodOptional<z.ZodString>;
    keychainService: z.ZodDefault<z.ZodString>;
    keychainAccount: z.ZodDefault<z.ZodString>;
    updatedAt: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    version: string;
    mode: "local" | "neon";
    databasePath: string;
    resumePath: string;
    keychainService: string;
    keychainAccount: string;
    workflowDataPath?: string | undefined;
    updatedAt?: string | undefined;
}, {
    mode: "local" | "neon";
    version?: string | undefined;
    databasePath?: string | undefined;
    resumePath?: string | undefined;
    workflowDataPath?: string | undefined;
    keychainService?: string | undefined;
    keychainAccount?: string | undefined;
    updatedAt?: string | undefined;
}>;
export type ServerConfig = z.infer<typeof ConfigSchema>;
export interface ResolvedConfig extends ServerConfig {
    configDir: string;
    databasePath: string;
    resumePath: string;
}
export declare function expandPath(p: string): string;
export declare function loadConfig(configPath?: string): ResolvedConfig;
