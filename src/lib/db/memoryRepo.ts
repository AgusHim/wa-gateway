import { prisma } from "./client";
import { createMemoryRepo } from "./memoryRepoFactory";

export { createMemoryRepo } from "./memoryRepoFactory";

export const memoryRepo = createMemoryRepo(prisma);
