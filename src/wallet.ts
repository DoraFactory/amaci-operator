import { HdPath, stringToPath } from '@cosmjs/crypto';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';

export async function GenerateWallet(index: number) {
	const mnemonic = process.env.MNEMONIC;

	if (!mnemonic) {
		console.log('Missing MNEMONIC in .env');
		process.exit(0);
	}

	const path: HdPath = stringToPath(
		"m/44'/" + '118' + "'/0'/0/" + index.toString()
	);
	const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
		prefix: 'dora',
		hdPaths: [path],
	});

	return wallet;
}