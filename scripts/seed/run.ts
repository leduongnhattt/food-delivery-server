import { prisma } from './_prisma';
import { seed01Roles } from './01-roles';
import { seed02Accounts } from './02-accounts';
import { seed03Profiles } from './03-profiles';
import { seed04Catalog } from './04-catalog';

async function main() {
  await seed01Roles(prisma);
  await seed02Accounts(prisma);
  await seed03Profiles(prisma);
  await seed04Catalog(prisma);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error('[seed] failed:', err);
    await prisma.$disconnect();
    process.exitCode = 1;
  });

