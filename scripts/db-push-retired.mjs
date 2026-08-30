#!/usr/bin/env node
// `npm run db:push` used to run `prisma db push`, which pushes schema.prisma
// straight at the database and records nothing. That is how Ace ended up with
// no migration history at all.
//
// The command is kept as a guard rather than deleted, because muscle memory is
// real and a silent `prisma db push` would put the database back out of step
// with prisma/migrations, which is exactly the state the baseline fixed.

console.error(`
  db:push is retired.

  It applied schema changes without recording them, which is why Ace had no
  migration history. Use the two-step flow instead:

      1.  edit prisma/schema.prisma
      2.  npm run db:migrate -- short-name-for-the-change     (writes the SQL)
      3.  read the SQL it prints
      4.  npm run db:deploy                                   (applies it)

  npm run db:status  tells you whether anything is waiting to be applied.

  If you genuinely need the old behaviour for a scratch database, run
  npx prisma db push by hand and know that it will create drift.
`);
process.exit(1);
