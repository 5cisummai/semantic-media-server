/**
 * Backfill script: Create default workspace and assign all existing users/chats.
 *
 * Run after applying the "add_workspaces_and_agent_runs" migration:
 *   npx tsx prisma/scripts/backfill-default-workspace.ts
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const DATABASE_URL =
	process.env.DATABASE_URL ?? 'postgresql://mediaserver:mediaserver@localhost:5432/mediaserver';

const adapter = new PrismaPg(DATABASE_URL);
const db = new PrismaClient({ adapter });

async function main() {
	console.log('Starting default workspace backfill...');

	// 1. Create "Default" workspace if it doesn't exist
	let workspace = await db.workspace.findUnique({ where: { slug: 'default' } });

	if (!workspace) {
		workspace = await db.workspace.create({
			data: {
				name: 'Default',
				slug: 'default',
				description: 'Default workspace for all users'
			}
		});
		console.log(`Created default workspace: ${workspace.id}`);
	} else {
		console.log(`Default workspace already exists: ${workspace.id}`);
	}

	// 2. Add all existing users as members (ADMIN for admins, MEMBER for others)
	const users = await db.user.findMany({ select: { id: true, role: true } });
	let membersCreated = 0;

	for (const user of users) {
		const existing = await db.workspaceMember.findUnique({
			where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } }
		});

		if (!existing) {
			await db.workspaceMember.create({
				data: {
					userId: user.id,
					workspaceId: workspace.id,
					role: user.role === 'ADMIN' ? 'ADMIN' : 'MEMBER'
				}
			});
			membersCreated++;
		}
	}

	console.log(`Added ${membersCreated} users as workspace members (${users.length} total users)`);

	// 3. Link all existing chat sessions to the default workspace
	const result = await db.chatSession.updateMany({
		where: { workspaceId: null },
		data: { workspaceId: workspace.id }
	});

	console.log(`Linked ${result.count} existing chat sessions to default workspace`);

	console.log('Backfill complete!');
}

main()
	.catch((e) => {
		console.error('Backfill failed:', e);
		process.exit(1);
	})
	.finally(() => db.$disconnect());
