import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { db } from '$lib/server/db';
import { env } from '$env/dynamic/private';
import type { UserRole } from '@prisma/client';

const ARGON2_OPTIONS = {
	type: argon2.argon2id,
	memoryCost: 2 ** 16,
	timeCost: 3,
	parallelism: 4
};

export async function hashPassword(password: string): Promise<string> {
	return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
	try {
		return await argon2.verify(hash, password);
	} catch {
		return false;
	}
}

// ── JWT (HS256, pure Node.js crypto — no extra deps) ─────────────────────────

export interface JwtPayload {
	sub: string; // user id
	username: string;
	role: UserRole;
	iat: number;
	exp: number;
	type?: 'access' | 'refresh';
}

export function generateAccessToken(payload: Omit<JwtPayload, 'iat' | 'exp' | 'type'>): string {
	const secret = env.JWT_SECRET;
	if (!secret) throw new Error('JWT_SECRET is not set');

	return jwt.sign({ ...payload, type: 'access' }, secret, {
		algorithm: 'HS256',
		expiresIn: '15m'
	});
}

export function generateRefreshToken(payload: Omit<JwtPayload, 'iat' | 'exp' | 'type'>): string {
	const secret = env.JWT_SECRET;
	if (!secret) throw new Error('JWT_SECRET is not set');

	return jwt.sign({ ...payload, type: 'refresh' }, secret, {
		algorithm: 'HS256',
		expiresIn: '7d'
	});
}

export function generateJwt(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
	const secret = env.JWT_SECRET;
	if (!secret) throw new Error('JWT_SECRET is not set');

	return jwt.sign(payload, secret, {
		algorithm: 'HS256',
		expiresIn: '7d'
	});
}

export function verifyJwt(token: string): JwtPayload | null {
	try {
		const secret = env.JWT_SECRET;
		if (!secret) return null;

		const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
		if (typeof decoded === 'string') return null;

		return decoded as JwtPayload;
	} catch {
		return null;
	}
}

// ── User helpers ──────────────────────────────────────────────────────────────

export async function createUser(opts: {
	username: string;
	displayName: string;
	password: string;
}) {
	const passwordHash = await hashPassword(opts.password);

	// Use a transaction to atomically determine if this is the first user.
	// Without this, two concurrent signups could both see count=0 and both
	// become ADMIN — a critical privilege escalation vulnerability.
	return db.$transaction(async (tx) => {
		const count = await tx.user.count();
		const isFirst = count === 0;

		return tx.user.create({
			data: {
				username: opts.username,
				displayName: opts.displayName,
				passwordHash,
				role: isFirst ? 'ADMIN' : 'USER',
				approved: isFirst
			}
		});
	});
}

export function findUserByUsername(username: string) {
	return db.user.findUnique({
		where: { username },
		select: {
			id: true,
			username: true,
			displayName: true,
			passwordHash: true,
			role: true,
			approved: true,
			deletedAt: true
		}
	});
}

export function getUserById(id: string) {
	return db.user.findUnique({ where: { id } });
}
