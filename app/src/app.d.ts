// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { UserRole } from '@prisma/client';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			user?: {
				id: string;
				username: string;
				role: UserRole;
			};
		}
		interface PageData {
			user?: {
				id: string;
				username: string;
				role: UserRole;
			};
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
