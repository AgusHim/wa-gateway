type CacheEntry<T> = {
    value: T;
    expiresAt: number;
};

export class RuntimeCache<T> {
    private readonly ttlMs: number;
    private readonly store = new Map<string, CacheEntry<T>>();

    constructor(ttlMs: number) {
        this.ttlMs = Math.max(1, Math.round(ttlMs));
    }

    get(key: string): T | null {
        const entry = this.store.get(key);
        if (!entry) {
            return null;
        }

        if (entry.expiresAt <= Date.now()) {
            this.store.delete(key);
            return null;
        }

        return entry.value;
    }

    set(key: string, value: T): T {
        this.store.set(key, {
            value,
            expiresAt: Date.now() + this.ttlMs,
        });
        return value;
    }

    invalidate(key: string): void {
        this.store.delete(key);
    }

    clear(): void {
        this.store.clear();
    }

    async getOrLoad(key: string, loader: () => Promise<T>): Promise<T> {
        const cached = this.get(key);
        if (cached !== null) {
            return cached;
        }

        const value = await loader();
        return this.set(key, value);
    }
}
