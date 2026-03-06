import { prisma } from "./client";
import { createMemoryRepo, type MemoryDbClient } from "./memoryRepoFactory";

export { createMemoryRepo } from "./memoryRepoFactory";

export const memoryRepo = createMemoryRepo(prisma as unknown as MemoryDbClient);
