import * as borsh from "borsh";
import * as web3 from "@solana/web3.js";
import {
  Connection,
  PublicKey,
  clusterApiUrl,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
  TransactionInstruction,
} from "@solana/web3.js";
import * as borsh from "borsh";
// Manually initialize variables that are automatically defined in Playground
const PROGRAM_ID = new web3.PublicKey("DRGtxC9Z1pmxgA6a4G9kQxivATjGGQ3CQWKNAfUhwUPU");
const connection = new web3.Connection("https://api.devnet.solana.com", "confirmed");
const wallet = { keypair: web3.Keypair.generate() };


//  the structure of the contract state
class ContractState {
  contractOwner: PublicKey;
  lastTokenId: number;

  constructor(fields: { contractOwner: Uint8Array; lastTokenId: number }) {
    this.contractOwner = new PublicKey(fields.contractOwner);
    this.lastTokenId = fields.lastTokenId;
  }
}

// Borsh schema for contract state
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

//  the program ID and connection
const PROGRAM_ID = new PublicKey(
  "DRGtxC9Z1pmxgA6a4G9kQxivATjGGQ3CQWKNAfUhwUPU"
);
const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

async function main() {
  const payer = Keypair.generate();

  // Airdrop SOL to the payer
  // await requestAndConfirmAirdrop(payer.publicKey);

  // Initialize Contract
  await initializeContract(payer);
  console.log("Contract initialized!");

  // Grant Mint Permission
  const gameId = "game_id";
  const tokenUri = "token_uri";
  await grantMintPermission(payer, gameId, tokenUri);
  console.log("Mint permission granted!");

  // Mint a new token
  await mintToken(payer, gameId);
  console.log("Token minted!");

  // Fetch and print contract state
  await printContractState();

  // Close connection
  // connection.close();
}

async function requestAndConfirmAirdrop(publicKey: PublicKey) {
  try {
    const airdropSignature = await connection.requestAirdrop(
      publicKey,
      1e9 // 1 SOL
    );
    await connection.confirmTransaction(airdropSignature);
  } catch (error) {
    throw new Error(`Error requesting airdrop: ${error}`);
  }
}

async function sendTransaction(
  instruction: TransactionInstruction,
  signers: Keypair[]
) {
  try {
    const transaction = new Transaction().add(instruction);
    // await sendAndConfirmTransaction(connection, transaction, signers);
  } catch (error) {
    throw new Error(`Error sending transaction: ${error}`);
  }
}

async function initializeContract(payer: Keypair) {
  const initializeContractData = Buffer.from(
    Uint8Array.of(0, ...payer.publicKey.toBytes())
  );
  const initializeContractIx = new TransactionInstruction({
    keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
    programId: PROGRAM_ID,
    data: initializeContractData,
  });
  await sendTransaction(initializeContractIx, [payer]);
}

async function grantMintPermission(
  payer: Keypair,
  gameId: string,
  tokenUri: string
) {
  const grantMintData = Buffer.concat([
    Buffer.from(Uint8Array.of(1)),
    payer.publicKey.toBuffer(),
    Buffer.from(gameId),
    Buffer.from(tokenUri),
  ]);
  const grantMintIx = new TransactionInstruction({
    keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
    programId: PROGRAM_ID,
    data: grantMintData,
  });
  await sendTransaction(grantMintIx, [payer]);
}

async function mintToken(payer: Keypair, gameId: string) {
  const mintData = Buffer.concat([
    Buffer.from(Uint8Array.of(2)),
    payer.publicKey.toBuffer(),
    Buffer.from(gameId),
  ]);
  const mintIx = new TransactionInstruction({
    keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
    programId: PROGRAM_ID,
    data: mintData,
  });
  await sendTransaction(mintIx, [payer]);
}

async function printContractState() {
  const accountInfo = await connection.getAccountInfo(PROGRAM_ID);
  if (!accountInfo) {
    throw new Error("Contract account not found");
  }
  // const contractState = borsh.deserialize(
  //   ContractStateSchema,
  //   ContractState,
  //   accountInfo.data,
  // );
  console.log("Contract state:", accountInfo);
}

main().catch((err) => {
  console.error(err);
});
