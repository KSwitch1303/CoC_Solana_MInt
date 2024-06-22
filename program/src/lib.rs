use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    program::invoke,
    program_error::ProgramError,
    program_pack::{IsInitialized, Pack, Sealed},
    pubkey::Pubkey,
    sysvar::{rent::Rent, Sysvar},
};

use spl_token::{
    instruction::{burn as spl_burn, initialize_account, initialize_mint, mint_to},
    state::{Account, Mint},
};

use borsh::{BorshDeserialize, BorshSerialize};

// Error codes
#[derive(Debug, BorshSerialize, BorshDeserialize, PartialEq)]
pub enum CustomError {
    NotAdmin,
    MintNotPermitted,
    NotTokenOwner,
    InvalidInstruction,
}

impl From<CustomError> for ProgramError {
    fn from(e: CustomError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

//  the contract's state
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct ContractState {
    pub contract_owner: Pubkey,
    pub last_token_id: u64,
}

impl Sealed for ContractState {}

impl IsInitialized for ContractState {
    fn is_initialized(&self) -> bool {
        true
    }
}

//  the mint permission structure
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct MintPermission {
    pub user: Pubkey,
    pub game_id: String,
    pub token_uri: String,
}

//  the instruction types
pub enum ContractInstruction {
    InitializeContract {
        owner: Pubkey,
    },
    GrantMint {
        user: Pubkey,
        game_id: String,
        token_uri: String,
    },
    Mint {
        receiver: Pubkey,
        game_id: String,
    },
    Transfer {
        token_id: u64,
        owner: Pubkey,
        receiver: Pubkey,
    },
    Burn {
        token_id: u64,
    },
}

impl ContractInstruction {
    pub fn unpack(input: &[u8]) -> Result<Self, ProgramError> {
        let (&variant, rest) = input.split_first().ok_or(CustomError::InvalidInstruction)?;
        Ok(match variant {
            0 => {
                let (owner, _) = Self::unpack_pubkey(rest)?;
                Self::InitializeContract { owner }
            }
            1 => {
                let (user, rest) = Self::unpack_pubkey(rest)?;
                let (game_id, rest) = Self::unpack_string(rest)?;
                let (token_uri, _) = Self::unpack_string(rest)?;
                Self::GrantMint {
                    user,
                    game_id,
                    token_uri,
                }
            }
            2 => {
                let (receiver, rest) = Self::unpack_pubkey(rest)?;
                let (game_id, _) = Self::unpack_string(rest)?;
                Self::Mint { receiver, game_id }
            }
            3 => {
                let (token_id, rest) = Self::unpack_u64(rest)?;
                let (owner, rest) = Self::unpack_pubkey(rest)?;
                let (receiver, _) = Self::unpack_pubkey(rest)?;
                Self::Transfer {
                    token_id,
                    owner,
                    receiver,
                }
            }
            4 => {
                let (token_id, _) = Self::unpack_u64(rest)?;
                Self::Burn { token_id }
            }
            _ => return Err(CustomError::InvalidInstruction.into()),
        })
    }

    fn unpack_pubkey(input: &[u8]) -> Result<(Pubkey, &[u8]), ProgramError> {
        if input.len() < 32 {
            return Err(CustomError::InvalidInstruction.into());
        }
        let (key, rest) = input.split_at(32);
        let pubkey = Pubkey::new_from_array(
            key.try_into()
                .map_err(|_| CustomError::InvalidInstruction)?,
        );
        Ok((pubkey, rest))
    }

    fn unpack_u64(input: &[u8]) -> Result<(u64, &[u8]), ProgramError> {
        if input.len() < 8 {
            return Err(CustomError::InvalidInstruction.into());
        }
        let (bytes, rest) = input.split_at(8);
        let value = u64::from_le_bytes(bytes.try_into().unwrap());
        Ok((value, rest))
    }

    fn unpack_string(input: &[u8]) -> Result<(String, &[u8]), ProgramError> {
        let length = input.len();
        let string = String::from_utf8(input[..length].to_vec())
            .map_err(|_| CustomError::InvalidInstruction)?;
        Ok((string, &input[length..]))
    }
}

// Entry point
entrypoint!(process_instruction);
fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let instruction = ContractInstruction::unpack(instruction_data)?;

    match instruction {
        ContractInstruction::InitializeContract { owner } => {
            initialize_contract(program_id, accounts, owner)
        }
        ContractInstruction::GrantMint {
            user,
            game_id,
            token_uri,
        } => grant_mint(program_id, accounts, user, game_id, token_uri),
        ContractInstruction::Mint { receiver, game_id } => {
            mint(program_id, accounts, receiver, game_id)
        }
        ContractInstruction::Transfer {
            token_id,
            owner,
            receiver,
        } => transfer(program_id, accounts, token_id, owner, receiver),
        ContractInstruction::Burn { token_id } => burn(program_id, accounts, token_id),
    }
}

fn initialize_contract(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    owner: Pubkey,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let contract_account = next_account_info(account_info_iter)?;

    let rent = &Rent::from_account_info(next_account_info(account_info_iter)?)?;
    if !rent.is_exempt(contract_account.lamports(), contract_account.data_len()) {
        return Err(ProgramError::AccountNotRentExempt);
    }

    let mut contract_state = ContractState::try_from_slice(&contract_account.data.borrow())?;
    contract_state.contract_owner = owner;
    contract_state.last_token_id = 0;
    contract_state.serialize(&mut &mut contract_account.data.borrow_mut()[..])?;

    Ok(())
}

fn grant_mint(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    user: Pubkey,
    game_id: String,
    token_uri: String,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let contract_account = next_account_info(account_info_iter)?;
    let admin_account = next_account_info(account_info_iter)?;

    let mut contract_state = ContractState::try_from_slice(&contract_account.data.borrow())?;
    if contract_state.contract_owner != *admin_account.key {
        return Err(CustomError::NotAdmin.into());
    }

    let mint_permission = MintPermission {
        user,
        game_id,
        token_uri,
    };
    mint_permission.serialize(&mut &mut contract_account.data.borrow_mut()[..])?;

    Ok(())
}

fn mint(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    receiver: Pubkey,
    game_id: String,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let contract_account = next_account_info(account_info_iter)?;
    let mint_account = next_account_info(account_info_iter)?;
    let receiver_account = next_account_info(account_info_iter)?;

    let mut contract_state = ContractState::try_from_slice(&contract_account.data.borrow())?;
    let mint_permission = MintPermission::try_from_slice(&contract_account.data.borrow())?;

    if mint_permission.user != *contract_account.key || mint_permission.game_id != game_id {
        return Err(CustomError::MintNotPermitted.into());
    }

    let token_id = contract_state.last_token_id + 1;
    contract_state.last_token_id = token_id;
    contract_state.serialize(&mut &mut contract_account.data.borrow_mut()[..])?;

    invoke(
        &mint_to(
            program_id,
            &mint_account.key,
            &receiver_account.key,
            &contract_account.key,
            &[],
            1,
        )?,
        &[
            mint_account.clone(),
            receiver_account.clone(),
            contract_account.clone(),
        ],
    )?;

    Ok(())
}

fn transfer(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: u64,
    owner: Pubkey,
    receiver: Pubkey,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let owner_account = next_account_info(account_info_iter)?;
    let receiver_account = next_account_info(account_info_iter)?;

    if *owner_account.key != owner {
        return Err(CustomError::NotTokenOwner.into());
    }

    invoke(
        &spl_token::instruction::transfer(
            program_id,
            &owner_account.key,
            &receiver_account.key,
            &owner_account.key,
            &[],
            1,
        )?,
        &[
            owner_account.clone(),
            receiver_account.clone(),
            owner_account.clone(),
        ],
    )?;

    Ok(())
}

fn burn(program_id: &Pubkey, accounts: &[AccountInfo], token_id: u64) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let owner_account = next_account_info(account_info_iter)?;
    let mint_account = next_account_info(account_info_iter)?;

    invoke(
        &spl_burn(
            program_id,
            &mint_account.key,
            &owner_account.key,
            &owner_account.key,
            &[],
            token_id,
        )?,
        &[
            mint_account.clone(),
            owner_account.clone(),
            owner_account.clone(),
        ],
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_program::{
        instruction::{AccountMeta, Instruction},
        program_pack::Pack,
        rent::Rent,
        sysvar,
    };
    use std::convert::TryInto;


}
