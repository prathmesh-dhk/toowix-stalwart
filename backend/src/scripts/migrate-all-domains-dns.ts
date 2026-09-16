import { connectDatabase, disconnectDatabase } from '../db/connection';
import { DomainModel } from '../db/models/Domain';
import { config } from '../config';
import { stalwartClient } from '../stalwart/client';
import { buildRequiredDnsRecords, buildZoneFileText } from '../services/dns-records.service';

async function migrateAllDomainsDns() {
  console.log('[DNS Migration] Connecting to database...');
  await connectDatabase({ uri: config.mongodbUri, autoIndex: false });

  const domains = await DomainModel.find({});
  console.log(`[DNS Migration] Found ${domains.length} domains in MongoDB to inspect.\n`);

  let updatedCount = 0;

  for (const d of domains) {
    console.log(`--- Processing domain: ${d.domainName} (ID: ${d._id}, Stalwart ID: ${d.stalwartDomainId || 'none'}) ---`);

    if (!d.stalwartDomainId) {
      console.log(`  Skipping Stalwart DKIM check (domain not yet provisioned in Stalwart).`);
      // Still generate canonical DNS records without DKIM for pre-activation display
      const records = buildRequiredDnsRecords(d.domainName, []);
      d.dnsRecords = records;
      d.dnsZoneFile = buildZoneFileText(d.domainName, records);
      await d.save();
      console.log(`  Updated canonical records & zone file in MongoDB.`);
      updatedCount++;
      continue;
    }

    try {
      // 1. Ensure Stalwart has automatic DKIM enabled for this domain
      console.log(`  Ensuring automatic DKIM configuration in Stalwart...`);
      await stalwartClient.ensureAutomaticDkim(d.stalwartDomainId);

      // 2. Fetch active DKIM keys (RSA and Ed25519)
      let dkimKeys = await stalwartClient.getActiveDkimKeys(d.stalwartDomainId);
      if (dkimKeys.length === 0) {
        console.log(`  Waiting for Stalwart to finish key generation...`);
        await new Promise((resolve) => setTimeout(resolve, 800));
        dkimKeys = await stalwartClient.getActiveDkimKeys(d.stalwartDomainId);
      }

      console.log(`  Retrieved ${dkimKeys.length} active DKIM key(s):`, dkimKeys.map((k) => `${k.selector} (${k.algorithm})`));

      // 3. Build canonical records (MX to mail.toowix.com, SPF with server IPs, DKIM keys, DMARC p=none)
      const records = buildRequiredDnsRecords(d.domainName, dkimKeys);
      const zoneFileText = buildZoneFileText(d.domainName, records);

      const rsaKey = dkimKeys.find((k) => k.algorithm === 'Dkim1RsaSha256') || dkimKeys[0];
      d.dkimSelector = rsaKey?.selector || null;
      d.dkimPublicKey = rsaKey?.publicKey || null;
      d.dnsRecords = records;
      d.dnsZoneFile = zoneFileText;

      await d.save();
      console.log(`  Successfully updated domain ${d.domainName} with ${records.length} canonical records and full zone file.`);
      updatedCount++;
    } catch (err: any) {
      console.error(`  Error processing domain ${d.domainName}:`, err.message);
    }
  }

  console.log(`\n[DNS Migration] Completed! Updated ${updatedCount}/${domains.length} domains.`);
  await disconnectDatabase();
}

migrateAllDomainsDns().catch((err) => {
  console.error('[DNS Migration Fatal Error]:', err);
  process.exit(1);
});
