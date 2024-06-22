import * as borsh from "borsh";
import * as web3 from "@solana/web3.js";
import {
  Connection,
  PublicKey,
  clusterApiUrl,
  Keypair,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  TransactionInstruction,
} from "@solana/web3.js";
import * as borsh from "borsh";
// Manually initialize variables that are automatically defined in Playground
const PROGRAM_ID = new web3.PublicKey("DRGtxC9Z1pmxgA6a4G9kQxivATjGGQ3CQWKNAfUhwUPU");
const connection = new web3.Connection("https://api.devnet.solana.com", "confirmed");
const wallet = { keypair: web3.Keypair.generate() };


// Define the structure of the contract state
class ContractState {
  contractOwner: PublicKey;
  lastTokenId: number;

  constructor(
    fields:
      | { contractOwner: Uint8Array; lastTokenId: number }
      | undefined = undefined
  ) {
    if (fields) {
      this.contractOwner = new PublicKey(fields.contractOwner);
      this.lastTokenId = fields.lastTokenId;
    } else {
      this.contractOwner = PublicKey.default;
      this.lastTokenId = 0;
    }
  }
}

// Define the structure of the mint permission
class MintPermission {
  user: PublicKey;
  gameId: string;
  tokenUri: string;

  constructor(
    fields:
      | { user: Uint8Array; gameId: string; tokenUri: string }
      | undefined = undefined
  ) {
    if (fields) {
      this.user = new PublicKey(fields.user);
      this.gameId = fields.gameId;
      this.tokenUri = fields.tokenUri;
    } else {
      this.user = PublicKey.default;
      this.gameId = "";
      this.tokenUri = "";
    }
  }
}

// Borsh schema for contract state and mint permission
const ContractStateSchema = new Map([
  [
    ContractState,
    {
      kind: "struct",
      fields: [
        ["contractOwner", [32]],
        ["lastTokenId", "u64"],
      ],
    },
  ],
]);

const MintPermissionSchema = new Map([
  [
    MintPermission,
    {
      kind: "struct",
      fields: [
        ["user", [32]],
        ["gameId", "string"],
        ["tokenUri", "string"],
      ],
    },
  ],
]);

const PROGRAM_ID = new PublicKey(
  "DRGtxC9Z1pmxgA6a4G9kQxivATjGGQ3CQWKNAfUhwUPU"
);

async function main() {
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  const payer = Keypair.generate();
  const programId = PROGRAM_ID;

  // Airdrop SOL to the payer
  const airdropSignature = await connection.requestAirdrop(
    payer.publicKey,
    1e9 // 1 SOL
  );
  await connection.confirmTransaction(airdropSignature);

  // Helper function to send transaction
  async function sendTransaction(
    instruction: TransactionInstruction,
    signers: Keypair[]
  ) {
    const transaction = new Transaction().add(instruction);
    await sendAndConfirmTransaction(connection, transaction, signers);
  }

  // Initialize Contract
  const initializeContractData = Buffer.from(
    Uint8Array.of(0, ...payer.publicKey.toBytes())
  );
  const initializeContractIx = new TransactionInstruction({
    keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
    programId: programId,
    data: initializeContractData,
  });
  await sendTransaction(initializeContractIx, [payer]);
  console.log("Contract initialized!");

  // Grant Mint Permission
  const gameId = "game_id";
  const tokenUri = "token_uri";
  const grantMintData = Buffer.concat([
    Buffer.from(Uint8Array.of(1)),
    payer.publicKey.toBuffer(),
    Buffer.from(gameId),
    Buffer.from(tokenUri),
  ]);
  const grantMintIx = new TransactionInstruction({
    keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
    programId: programId,
    data: grantMintData,
  });
  await sendTransaction(grantMintIx, [payer]);
  console.log("Mint permission granted!");

  // Mint a new token
  const mintData = Buffer.concat([
    Buffer.from(Uint8Array.of(2)),
    payer.publicKey.toBuffer(),
    Buffer.from(gameId),
  ]);
  const mintIx = new TransactionInstruction({
    keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
    programId: programId,
    data: mintData,
  });
  await sendTransaction(mintIx, [payer]);
  console.log("Token minted!");

  // Fetch and print contract state
  const accountInfo = await connection.getAccountInfo(programId);
  if (accountInfo === null) {
    throw "Error: cannot find the account";
  }
  const contractState = borsh.deserialize(
    ContractStateSchema,
    ContractState,
    accountInfo.data
  );
  console.log("Contract state:", contractState);
}

main().catch((err) => {
  console.error(err);
});
