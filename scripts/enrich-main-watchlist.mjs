import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'db', 'package.json'),
);
const { Client } = require('pg');

/**
 * One-off enrichment for the tokens in the default "Основная" watchlist group.
 * Matching is by BSC contract address, so renamed tickers (AKE/AKEDO, CYC/CYCLE,
 * ON/OROCHI, Q/QUACK AI, SAHARA/SHRAI) are handled without touching symbols.
 *
 * Usage:
 *   node scripts/enrich-main-watchlist.mjs --dry-run
 *   node scripts/enrich-main-watchlist.mjs
 */
const records = [
  {
    address: '0x2c3a8ee94ddd97244a93bc48298f97d2c412f7db',
    thesis:
      'AKEDO — AI-платформа для создания игр и контента на BNB Chain: мультиагентный движок превращает текстовый запрос в готовую игру и токенизированную коллекцию. В январе 2026 привлекла $5M seed.',
    twitterUrl: 'https://x.com/akedofun',
    websiteUrl: 'https://akedo.fun',
    telegramUrl: 'https://t.me/akedofun',
    discordUrl: null,
    investors: [
      'Karatage',
      'Sfermion',
      'Collab+Currency',
      'MARBLEX',
      'Seed Club',
      'The Open Platform',
      'TON Ventures',
      'Gagra Ventures',
      'Kenetic Capital',
      'Metalabs Ventures',
    ],
  },
  {
    address: '0x299ad4299da5b2b93fba4c96967b040c7f611099',
    thesis:
      'APR — токен Capricorn (ранее aPriori): AI/MEV-инфраструктура и ликвидный стейкинг MON на Monad. Токен выпущен на Ethereum, BNB Chain и Monad; BSC-версия торгуется на Binance Alpha.',
    twitterUrl: 'https://x.com/capricorn_tech',
    websiteUrl: 'https://capricorn.tech',
    telegramUrl: null,
    discordUrl: null,
    investors: [
      'Pantera Capital',
      'YZi Labs (Binance Labs)',
      'Consensys',
      'OKX Ventures',
      'HashKey Capital',
      'Primitive Ventures',
      'CMS Holdings',
      'Laser Digital',
      'Flow Traders',
      'Arrington Capital',
      'Hashed',
      'IMC Trading',
    ],
  },
  {
    address: '0x1d28d989f9e3ccb8b15d0cec601734514f958e4d',
    thesis:
      'BASED — токен Based: self-custody суперприложение для торговли на Hyperliquid, предиктивных рынков и Visa-карты. Выпущен по стандарту LayerZero OFT на BSC, Ethereum и Hyperliquid.',
    twitterUrl: 'https://x.com/BasedOneX',
    websiteUrl: 'https://based.one',
    telegramUrl: 'https://t.me/BasedOneVerification',
    discordUrl: null,
    investors: [
      'Pantera Capital',
      'Coinbase Ventures',
      'Wintermute Ventures',
      'Karatage',
      'Ethena',
      'Hashed',
      'Spartan Group',
    ],
  },
  {
    address: '0x81d3a238b02827f62b9f390f947d36d4a5bf89d2',
    thesis:
      'CLO — токен Clovis (Yei Finance): кросс-чейн clearing- и settlement-слой, который объединяет ликвидность для lending, swap и bridge в одном аккаунте.',
    twitterUrl: 'https://x.com/ClovisNetwork',
    websiteUrl: 'https://clovis.network',
    telegramUrl: null,
    discordUrl: 'https://discord.gg/yei',
    investors: [
      'Manifold Trading',
      'DWF Ventures',
      'Kronos Research',
      'Outlier Ventures',
      'Side Door Ventures',
      'WOO Network',
    ],
  },
  {
    address: '0x14778860e937f509e651192a90589de711fb88a9',
    thesis:
      'CYBER — токен Cyber (CyberConnect): L2 для социальных приложений с account abstraction, социальным графом CyberConnect и инструментами для создания и монетизации контента.',
    twitterUrl: 'https://x.com/BuildOnCyber',
    websiteUrl: 'https://cyber.co',
    telegramUrl: 'https://t.me/buildoncyber',
    discordUrl: 'https://discord.com/invite/buildoncyber',
    investors: [
      'Multicoin Capital',
      'Animoca Brands',
      'Sky9 Capital',
      'Delphi Digital',
      'Protocol Labs',
      'IOSG Ventures',
      'Tribe Capital',
      'GGV Capital',
      'Spartan Group',
      'Amber Group',
      'Polygon Studios',
      'SevenX Ventures',
      'Hashed',
      'YZi Labs (Binance Labs)',
    ],
  },
  {
    address: '0x5845684b49aef79a5c0f887f50401c247dca7ac6',
    thesis:
      'CYCLE (CYC) — токен Cycle Network: omni-chain settlement layer с Verifiable State Aggregation, который позволяет переводить активы и состояние между сетями без классических мостов.',
    twitterUrl: 'https://x.com/cyclenetwork_GO',
    websiteUrl: 'https://www.cyclenetwork.io',
    telegramUrl: 'https://t.me/cycle_network',
    discordUrl: null,
    investors: [
      'Vertex Ventures',
      'Summer Ventures',
      'YZi Labs (Binance Labs)',
      'Manta Network',
      'SuperChain Capital',
      'GSG',
      'LTP',
      'Vertex Labs',
    ],
  },
  {
    address: '0x30117e4bc17d7b044194b76a38365c53b72f7d49',
    thesis:
      'GWEI — токен ETHGas: маркетплейс блокспейса Ethereum и фьючерсов на газ. Проект строит realtime- и gasless-транзакции, превращая газ в торгуемый финансовый примитив.',
    twitterUrl: 'https://x.com/ETHGasOfficial',
    websiteUrl: 'https://www.ethgas.com',
    telegramUrl: null,
    discordUrl: null,
    investors: [
      'Polychain Capital',
      'Amber Group',
      'BlueYard Capital',
      'Stake Capital',
      'SIG DT',
      'Keyrock',
      'Node.Capital',
      'Tokka Labs',
    ],
  },
  {
    address: '0x4bfaa776991e85e5f8b1255461cbbd216cfc714f',
    thesis:
      'HOME — токен Defi App: self-custody суперприложение с кросс-чейн swap, перпетуалами, yield и газ-абстракцией. Токен также выпущен на Base и Solana.',
    twitterUrl: 'https://x.com/defiapp',
    websiteUrl: 'https://defi.app',
    telegramUrl: 'https://t.me/OfficialDefiApp',
    discordUrl: 'https://discord.com/invite/defiapp',
    investors: [
      'Mechanism Capital',
      'Selini Capital',
      'North Rock Digital',
      'DCF Capital Partners',
      'Balaji Srinivasan',
      'Pentoshi',
      'Echo / Comfy Capital',
    ],
  },
  {
    address: '0x91152b4ef635403efbae860edd0f8c321d7c035d',
    thesis:
      'IRYS — программируемый data-chain: объединяет дешёвое on-chain хранение данных с EVM-совместимым IrysVM, чтобы данные могли содержать исполняемые правила для AI и DeFi.',
    twitterUrl: 'https://x.com/irys_xyz',
    websiteUrl: 'https://irys.xyz',
    telegramUrl: null,
    discordUrl: null,
    investors: [
      'CoinFund',
      'Lemniscap',
      'Primitive Ventures',
      'Amber Group',
      'Arweave',
      'Framework Ventures',
      'Hypersphere Ventures',
      'Breed VC',
      'Tykhe Ventures',
      'Varrock Ventures',
    ],
  },
  {
    address: '0x0e4f6209ed984b21edea43ace6e09559ed051d48',
    thesis:
      'OROCHI (ON) — Verifiable Data Infrastructure на ZK: zkDatabase подтверждает подлинность данных для RWA, stablecoin и AI-приложений. Привлёк более $20M финансирования.',
    twitterUrl: 'https://x.com/OrochiNetwork',
    websiteUrl: 'https://orochi.network',
    telegramUrl: 'https://t.me/OrochiNetwork',
    discordUrl: null,
    investors: [
      'MEXC Ventures',
      'Plutus VC',
      'Bolts Capital',
      'Ant Labs',
      'Presto Labs',
      'Anti Capital',
      'SMAPE Capital',
      'Ethereum Foundation (grant)',
    ],
  },
  {
    address: '0xa3cfb853339b77f385b994799b015cb04b208fe6',
    thesis:
      'POP — токен Zypher Network: ZK-инфраструктура и AI-rollup Zytron для верифицируемого исполнения AI-агентов. Ключевые протоколы — Proof of Prompt и Proof of Inference.',
    twitterUrl: 'https://x.com/Zypher_Network',
    websiteUrl: 'https://zypher.network',
    telegramUrl: 'https://t.me/zyphernetwork',
    discordUrl: null,
    investors: [
      'UOB Venture Management',
      'Signum Capital',
      'HashKey Capital',
      'Hong Leong Group',
      'Cogitent Ventures',
      'CatcherVC',
      'Hydrogenesis Labs',
      'DWF Ventures',
    ],
  },
  {
    address: '0xc07e1300dc138601fa6b0b59f8d0fa477e690589',
    thesis:
      'QUACK AI (Q) — AI-governance слой для Web3: агенты анализируют предложения DAO, голосуют и исполняют решения. Стандарт Q402/x402 добавляет платежи и газлес-исполнение для агентов.',
    twitterUrl: 'https://x.com/QuackAI_AI',
    websiteUrl: 'https://quackai.ai',
    telegramUrl: 'https://t.me/QuackAIAnn',
    discordUrl: null,
    investors: [
      'Animoca Brands',
      'Kenetic Capital',
      'Skyland Ventures',
      '071 Labs',
      'Scaling Labs',
      'CARV Labs',
      'Merlin Chain',
    ],
  },
  {
    address: '0xfdffb411c4a70aa7c95d5c981a6fb4da867e1111',
    thesis:
      'SAHARA — токен Sahara AI: full-stack AI-native блокчейн-платформа, где можно создавать, владеть и монетизировать AI-модели, данные и агентов. В базе токен записан как SHRAI.',
    twitterUrl: 'https://x.com/SaharaAI',
    websiteUrl: 'https://saharaai.com',
    telegramUrl: 'https://t.me/saharaaiofficial',
    discordUrl: 'https://discord.gg/sahara-ai',
    investors: [
      'Pantera Capital',
      'YZi Labs (Binance Labs)',
      'Polychain Capital',
      'Samsung NEXT',
      'Sequoia Capital',
      'Matrix Partners',
      'dao5',
      'Geekcartel',
      'Nomad Capital',
      'SCB 10X',
    ],
  },
  {
    address: '0x6dc200b21894af4660b549b678ea8df22bf7cfac',
    thesis:
      'WARD — токен Warden Protocol: L1 для AI-агентов с верифицируемым исполнением SPEX. В 2026 WARD мигрировал на Base с bridged-версией на BNB Chain.',
    twitterUrl: 'https://x.com/wardenprotocol',
    websiteUrl: 'https://wardenprotocol.org',
    telegramUrl: null,
    discordUrl: null,
    investors: ['0G', 'Messari', 'Venice.AI'],
  },
  {
    address: '0xe3225e11cab122f1a126a28997788e5230838ab9',
    thesis:
      'XNY — токен Codatta: децентрализованный протокол данных для AI, который превращает аннотированные данные в токенизированные активы и платит авторам роялти за использование.',
    twitterUrl: 'https://x.com/codatta_io',
    websiteUrl: 'https://codatta.io',
    telegramUrl: 'https://t.me/codatta_io',
    discordUrl: 'https://discord.gg/YCESVmHEYv',
    investors: [
      'OKX Ventures',
      'Comma3 Ventures',
      'Mask Network',
      'Oak Grove Ventures',
      'Paramita Capital',
      'Web3Port',
      'CGV',
      'CatcherVC',
      'GoPlus',
      'zCloak Network',
    ],
  },
];

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let updated = 0;

  try {
    await client.query('BEGIN');

    for (const record of records) {
      const matches = await client.query(
        `SELECT w.id, w.user_id, w.thesis, w.twitter_url, w.website_url,
                w.telegram_url, w.discord_url, w.investors
           FROM watchlist w
           JOIN assets a ON a.id = w.asset_id
           JOIN chains ch ON ch.id = a.chain_id
          WHERE ch.code = 'bsc'
            AND (lower(coalesce(a.contract_address, '')) = $1
                 OR lower(coalesce(w.bsc_contract_address, '')) = $1)`,
        [record.address],
      );

      if (matches.rowCount === 0) {
        console.log(`skip ${record.address}: not found`);
        continue;
      }

      for (const row of matches.rows) {
        if (dryRun) {
          console.log(`would update ${row.id} (${record.address})`);
          continue;
        }

        await client.query(
          `UPDATE watchlist
              SET thesis = $2,
                  twitter_url = $3,
                  website_url = $4,
                  telegram_url = $5,
                  discord_url = $6,
                  investors = $7::text[],
                  updated_at = now()
            WHERE id = $1`,
          [
            row.id,
            record.thesis,
            record.twitterUrl,
            record.websiteUrl,
            record.telegramUrl,
            record.discordUrl,
            record.investors,
          ],
        );

        await client.query(
          `INSERT INTO audit_log (user_id, action, entity_type, entity_id, before, after)
           VALUES ($1, 'watchlist.enriched', 'watchlist', $2, $3::jsonb, $4::jsonb)`,
          [
            row.user_id,
            row.id,
            JSON.stringify({
              thesis: row.thesis,
              twitterUrl: row.twitter_url,
              websiteUrl: row.website_url,
              telegramUrl: row.telegram_url,
              discordUrl: row.discord_url,
              investors: row.investors,
            }),
            JSON.stringify({
              thesis: record.thesis,
              twitterUrl: record.twitterUrl,
              websiteUrl: record.websiteUrl,
              telegramUrl: record.telegramUrl,
              discordUrl: record.discordUrl,
              investors: record.investors,
            }),
          ],
        );

        updated += 1;
      }
    }

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('dry run complete, rolled back');
    } else {
      await client.query('COMMIT');
      console.log(`updated ${updated} watchlist rows`);
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
