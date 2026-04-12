import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { env } from '$env/dynamic/private';

const DEFAULT_LOCAL_DATABASE_URL =
	'postgresql://mediaserver:mediaserver@localhost:5432/mediaserver';

function getDatabaseUrl() {
	const databaseUrl = env.DATABASE_URL?.trim();

	if (!databaseUrl) {
		if (process.env.NODE_ENV !== 'production') {
			return DEFAULT_LOCAL_DATABASE_URL;
		}

		throw new Error('DATABASE_URL is not set');
	}

	let parsedUrl: URL;
	try {
		parsedUrl = new URL(databaseUrl);
	} catch {
		throw new Error('DATABASE_URL must be a valid PostgreSQL connection string');
	}

	if (!parsedUrl.password) {
		if (process.env.NODE_ENV !== 'production') {
			parsedUrl.password = env.DB_PASSWORD?.trim();
			if (!parsedUrl.password) {
				throw new Error(
					'DB_PASSWORD must be set in development when DATABASE_URL does not include a password'
				);
			}
			return parsedUrl.toString();
		}

		throw new Error('DATABASE_URL must include a database password');
	}

	return databaseUrl;
}

function createClient() {
	const adapter = new PrismaPg(getDatabaseUrl());
	return new PrismaClient({ adapter });
}

/** True when this process still holds a PrismaClient from before `prisma generate` added models. */
function isStaleClient(client: PrismaClient): boolean {
	const workspace = (client as unknown as { workspace?: { findUnique?: unknown } }).workspace;
	return typeof workspace?.findUnique !== 'function';
}

function getFreshClient(): PrismaClient {
	let client = globalForPrisma.prisma ?? createClient();
	if (isStaleClient(client)) {
		void client.$disconnect().catch(() => {});
		client = createClient();
	}
	return client;
}

// Re-use a single client in development (hot-reload safe via globalThis)
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const db = getFreshClient();

if (process.env.NODE_ENV !== 'production') {
	globalForPrisma.prisma = db;
}

/** After `prisma generate`, the old singleton can lack new models (e.g. chatSession). Drop it on HMR. */
if (import.meta.env.DEV && import.meta.hot) {
	import.meta.hot.dispose(async () => {
		await globalForPrisma.prisma?.$disconnect().catch(() => {});
		globalForPrisma.prisma = undefined;
	});
}
