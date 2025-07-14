/* eslint-disable no-await-in-loop */
/* global actions, api */

const NB_APPROVALS_ALLOWED = 30;
const NB_TOP_WITNESSES = 20;
const NB_BACKUP_WITNESSES = 1;
const NB_WITNESSES = NB_TOP_WITNESSES + NB_BACKUP_WITNESSES;
const NB_WITNESSES_SIGNATURES_REQUIRED = 14;
const MAX_ROUNDS_MISSED_IN_A_ROW = 3; // after that the witness is disabled
const MAX_ROUND_PROPOSITION_WAITING_PERIOD = 40; // number of blocks
const NB_TOKENS_TO_REWARD_PER_BLOCK = '0.01902586'; // inflation.js tokens per block
const NB_TOKENS_NEEDED_BEFORE_REWARDING = '0.39954306'; // 21x to reward
// eslint-disable-next-line max-len
const WITNESS_APPROVE_EXPIRE_BLOCKS = 5184000; // Approximately half a year, 20 blocks a minute * 60 minutes an hour * 24 hours a day * 180 days
const WITNESS_MAX_ACCOUNT_EXPIRE_PER_BLOCK = 10;
// eslint-disable-next-line no-template-curly-in-string
const UTILITY_TOKEN_SYMBOL = "'${CONSTANTS.UTILITY_TOKEN_SYMBOL}$'";
// eslint-disable-next-line no-template-curly-in-string
const UTILITY_TOKEN_PRECISION = '${CONSTANTS.UTILITY_TOKEN_PRECISION}$';
// eslint-disable-next-line no-template-curly-in-string
const GOVERNANCE_TOKEN_SYMBOL = "'${CONSTANTS.GOVERNANCE_TOKEN_SYMBOL}$'";
// eslint-disable-next-line no-template-curly-in-string
const GOVERNANCE_TOKEN_PRECISION = '${CONSTANTS.GOVERNANCE_TOKEN_PRECISION}$';
// eslint-disable-next-line no-template-curly-in-string
const GOVERNANCE_TOKEN_MIN_VALUE = "'${CONSTANTS.GOVERNANCE_TOKEN_MIN_VALUE}$'";

const recalcTotalEnabledApprovalWeight = async () => {
  let totalEnabledApprovalWeight = '0';
  let offset = 0;
  let wits;

  do {
    wits = await api.db.find('witnesses', {}, 1000, offset, [{ index: '_id', descending: false }]);
    for (let i = 0; i < wits.length; i += 1) {
      const wit = wits[i];
      if (wit.enabled) {
        totalEnabledApprovalWeight = api.BigNumber(totalEnabledApprovalWeight)
          .plus(wit.approvalWeight.$numberDecimal).toFixed(GOVERNANCE_TOKEN_PRECISION);
      }
    }
    offset += 1000;
  } while (wits.length === 1000);

  return totalEnabledApprovalWeight;
};

actions.createSSC = async () => {
  const tableExists = await api.db.tableExists('witnesses');

  if (tableExists === false) {
    await api.db.createTable('witnesses', ['approvalWeight']);
    await api.db.createTable('approvals', ['from', 'to']);
    await api.db.createTable('accounts', ['account']);
    await api.db.createTable('schedules');
    await api.db.createTable('params');

    const params = {
      totalApprovalWeight: '0', // deprecated in favor of totalEnabledApprovalWeight, but do not remove immediately in case we need to go back to using this if any major issue is found
      totalEnabledApprovalWeight: '0',
      numberOfApprovedWitnesses: 0,
      lastVerifiedBlockNumber: 0,
      round: 0,
      lastBlockRound: 0,
      currentWitness: null,
      blockNumberWitnessChange: 0,
      lastWitnesses: [],
      numberOfApprovalsPerAccount: NB_APPROVALS_ALLOWED,
      numberOfTopWitnesses: NB_TOP_WITNESSES,
      numberOfWitnessSlots: NB_WITNESSES,
      witnessSignaturesRequired: NB_WITNESSES_SIGNATURES_REQUIRED,
      maxRoundsMissedInARow: MAX_ROUNDS_MISSED_IN_A_ROW,
      maxRoundPropositionWaitingPeriod: MAX_ROUND_PROPOSITION_WAITING_PERIOD,
      witnessApproveExpireBlocks: WITNESS_APPROVE_EXPIRE_BLOCKS,
    };

    await api.db.insert('params', params);
  } else {
    const params = await api.db.findOne('params', {});
    // This should be removed after being deployed
    if (!params.totalEnabledApprovalWeight || params.totalEnabledApprovalWeight === 'NaN') {
      params.totalEnabledApprovalWeight = await recalcTotalEnabledApprovalWeight();
      await api.db.update('params', params);
    }
    // End block to remove
  }
};

actions.resetSchedule = async () => {
  if (api.sender !== api.owner) return;

  const schedules = await api.db.find('schedules', {});

  for (let index = 0; index < schedules.length; index += 1) {
    const schedule = schedules[index];
    await api.db.remove('schedules', schedule);
  }

  const params = await api.db.findOne('params', {});
  params.currentWitness = null;
  params.blockNumberWitnessChange = 0;
  params.lastWitnesses = [];
  params.totalEnabledApprovalWeight = await recalcTotalEnabledApprovalWeight();
  await api.db.update('params', params);
};

actions.recalculateApprovals = async (payload) => {
  if (api.sender !== api.owner) return;

  const witnessRec = await api.db.findOne('witnesses', { account: payload.witness });
  if (!witnessRec) return;

  let newApprovalWeight = api.BigNumber(0);
  const approvals = await api.db.find('approvals', { to: payload.witness });
  for (let i = 0; i < approvals.length; i += 1) {
    const approval = approvals[i];
    const account = await api.db.findOne('accounts', { account: approval.from });
    if (account) {
      newApprovalWeight = api.BigNumber(newApprovalWeight).plus(account.approvalWeight).toFixed(GOVERNANCE_TOKEN_PRECISION);
    }
  }
  const oldApprovalWeight = witnessRec.approvalWeight.$numberDecimal;
  const deltaApprovalWeight = api.BigNumber(newApprovalWeight)
    .minus(oldApprovalWeight)
    .toFixed(GOVERNANCE_TOKEN_PRECISION);
  await updateWitnessRank(payload.witness, deltaApprovalWeight);
};

actions.updateParams = async (payload) => {
  if (api.sender !== api.owner) return;

  const {
    numberOfApprovalsPerAccount,
    numberOfTopWitnesses,
    numberOfWitnessSlots,
    witnessSignaturesRequired,
    maxRoundsMissedInARow,
    maxRoundPropositionWaitingPeriod,
    witnessApproveExpireBlocks,
  } = payload;

  const params = await api.db.findOne('params', {});
  let shouldResetSchedule = false;

  if (numberOfApprovalsPerAccount && Number.isInteger(numberOfApprovalsPerAccount)) {
    params.numberOfApprovalsPerAccount = numberOfApprovalsPerAccount;
  }
  if (numberOfTopWitnesses && Number.isInteger(numberOfTopWitnesses)) {
    params.numberOfTopWitnesses = numberOfTopWitnesses;
  }
  if (numberOfWitnessSlots && Number.isInteger(numberOfWitnessSlots)
    && params.numberOfWitnessSlots !== numberOfWitnessSlots) {
    shouldResetSchedule = true;
    params.numberOfWitnessSlots = numberOfWitnessSlots;
  }
  if (witnessSignaturesRequired && Number.isInteger(witnessSignaturesRequired)) {
    params.witnessSignaturesRequired = witnessSignaturesRequired;
  }
  if (maxRoundsMissedInARow && Number.isInteger(maxRoundsMissedInARow)) {
    params.maxRoundsMissedInARow = maxRoundsMissedInARow;
  }
  if (maxRoundPropositionWaitingPeriod && Number.isInteger(maxRoundPropositionWaitingPeriod)) {
    params.maxRoundPropositionWaitingPeriod = maxRoundPropositionWaitingPeriod;
  }
  if (!api.assert(params.numberOfTopWitnesses + 1 === params.numberOfWitnessSlots, 'only 1 backup allowed')) {
    return;
  }
  if (witnessApproveExpireBlocks && Number.isInteger(witnessApproveExpireBlocks)
    && api.assert(witnessApproveExpireBlocks > params.numberOfWitnessSlots, 'witnessApproveExpireBlocks should be greater than numberOfWitnessSlots')) {
    params.witnessApproveExpireBlocks = witnessApproveExpireBlocks;
  }
  await api.db.update('params', params);
  if (shouldResetSchedule) {
    await actions.resetSchedule();
  }
};

const updateWitnessRank = async (witness, approvalWeight) => {
  // check if witness exists
  const witnessRec = await api.db.findOne('witnesses', { account: witness });

  if (witnessRec) {
    // update witness approvalWeight
    const oldApprovalWeight = witnessRec.approvalWeight.$numberDecimal;
    witnessRec.approvalWeight.$numberDecimal = api.BigNumber(
      witnessRec.approvalWeight.$numberDecimal,
    )
      .plus(approvalWeight)
      .toFixed(GOVERNANCE_TOKEN_PRECISION);

    // Don't allow witness to have negative approval weight.
    if (api.BigNumber(witnessRec.approvalWeight.$numberDecimal).lt(0)) {
      witnessRec.approvalWeight.$numberDecimal = api.BigNumber(0);
    }

    await api.db.update('witnesses', witnessRec);

    const params = await api.db.findOne('params', {});

    // update totalApprovalWeight
    params.totalApprovalWeight = api.BigNumber(params.totalApprovalWeight)
      .plus(approvalWeight)
      .toFixed(GOVERNANCE_TOKEN_PRECISION);

    // if witness is enabled, add update  totalEnabledApprovalWeight
    if (witnessRec.enabled) {
      params.totalEnabledApprovalWeight = api.BigNumber(params.totalEnabledApprovalWeight)
        .plus(approvalWeight).toFixed(GOVERNANCE_TOKEN_PRECISION);
    }

    // update numberOfApprovedWitnesses
    if (api.BigNumber(oldApprovalWeight).eq(0)
      && api.BigNumber(witnessRec.approvalWeight.$numberDecimal).gt(0)) {
      params.numberOfApprovedWitnesses += 1;
    } else if (api.BigNumber(oldApprovalWeight).gt(0)
      && api.BigNumber(witnessRec.approvalWeight.$numberDecimal).eq(0)) {
      params.numberOfApprovedWitnesses -= 1;
    }

    await api.db.update('params', params);
  }
};

actions.updateWitnessesApprovals = async (payload) => {
  const { account, callingContractInfo } = payload;

  if (callingContractInfo === undefined) return;
  if (callingContractInfo.name !== 'tokens') return;

  const acct = await api.db.findOne('accounts', { account });
  if (acct !== null) {
    // calculate approval weight of the account
    const balance = await api.db.findOneInTable('tokens', 'balances', { account, symbol: GOVERNANCE_TOKEN_SYMBOL });
    let approvalWeight = 0;
    if (balance && balance.stake) {
      approvalWeight = balance.stake;
    }

    if (balance && balance.delegationsIn) {
      approvalWeight = api.BigNumber(approvalWeight)
        .plus(balance.delegationsIn)
        .toFixed(GOVERNANCE_TOKEN_PRECISION);
    }

    const oldApprovalWeight = acct.approvalWeight;

    const deltaApprovalWeight = api.BigNumber(approvalWeight)
      .minus(oldApprovalWeight)
      .toFixed(GOVERNANCE_TOKEN_PRECISION);

    acct.approvalWeight = approvalWeight;

    if (!api.BigNumber(deltaApprovalWeight).eq(0)) {
      await api.db.update('accounts', acct);

      const approvals = await api.db.find('approvals', { from: account });

      for (let index = 0; index < approvals.length; index += 1) {
        const approval = approvals[index];
        await updateWitnessRank(approval.to, deltaApprovalWeight);
      }
    }
  }
};

actions.register = async (payload) => {
  const {
    domain, IP, RPCPort, P2PPort, signingKey, enabled, isSignedWithActiveKey,
  } = payload;

  if (api.assert(isSignedWithActiveKey === true, 'active key required')
    && api.assert(domain || IP, 'neither domain nor ip provided')
    && api.assert(!(domain && IP), 'both domain and ip provided')
    && ((domain && api.assert(domain && typeof domain === 'string' && api.validator.isFQDN(domain), 'domain is invalid')) || (IP && api.assert(IP && typeof IP === 'string' && api.validator.isIP(IP), 'IP is invalid')))
    && api.assert(RPCPort && Number.isInteger(RPCPort) && RPCPort >= 0 && RPCPort <= 65535, 'RPCPort must be an integer between 0 and 65535')
    && api.assert(P2PPort && Number.isInteger(P2PPort) && P2PPort >= 0 && P2PPort <= 65535, 'P2PPort must be an integer between 0 and 65535')
    && api.assert(api.validator.isAlphanumeric(signingKey) && signingKey.length === 53, 'invalid signing key')
    && api.assert(typeof enabled === 'boolean', 'enabled must be a boolean')) {
    // check if there is already a witness with the same signing key
    let witness = await api.db.findOne('witnesses', { signingKey });

    if (api.assert(witness === null || witness.account === api.sender, 'a witness is already using this signing key')) {
      // check if there is already a witness with the same IP/Port or domain
      if (IP) {
        witness = await api.db.findOne('witnesses', { IP, P2PPort });
      } else {
        witness = await api.db.findOne('witnesses', { domain, P2PPort });
      }

      if (api.assert(witness === null || witness.account === api.sender, `a witness is already using this ${IP ? 'IP' : 'domain'}/Port`)) {
        witness = await api.db.findOne('witnesses', { account: api.sender });

        // if the witness is already registered
        if (witness) {
          const enabledChanged = witness.enabled !== enabled;
          let useUnsets = false;
          const unsets = {};
          if (IP) {
            witness.IP = IP;
            if (witness.domain) {
              delete witness.domain;
              unsets.domain = '';
              useUnsets = true;
            }
          } else {
            witness.domain = domain;
            if (witness.IP) {
              delete witness.IP;
              unsets.IP = '';
              useUnsets = true;
            }
          }
          witness.RPCPort = RPCPort;
          witness.P2PPort = P2PPort;
          witness.signingKey = signingKey;
          witness.enabled = enabled;
          if (useUnsets) {
            await api.db.update('witnesses', witness, unsets);
          } else {
            await api.db.update('witnesses', witness);
          }
          const params = await api.db.findOne('params', {});
          // update totalEnabledApprovalWeight if the witness' enable status changed
          if (enabledChanged && witness.enabled) {
            params.totalEnabledApprovalWeight = api.BigNumber(params.totalEnabledApprovalWeight)
              .plus(witness.approvalWeight.$numberDecimal).toFixed(GOVERNANCE_TOKEN_PRECISION);
          } else if (enabledChanged && !witness.enabled) {
            params.totalEnabledApprovalWeight = api.BigNumber(params.totalEnabledApprovalWeight)
              .minus(witness.approvalWeight.$numberDecimal).toFixed(GOVERNANCE_TOKEN_PRECISION);
          }
          await api.db.update('params', params);
        } else {
          witness = {
            account: api.sender,
            approvalWeight: { $numberDecimal: '0' },
            signingKey,
            RPCPort,
            P2PPort,
            enabled,
            missedRounds: 0,
            missedRoundsInARow: 0,
            verifiedRounds: 0,
            lastRoundVerified: null,
            lastBlockVerified: null,
          };
          if (IP) {
            witness.IP = IP;
          } else {
            witness.domain = domain;
          }
          await api.db.insert('witnesses', witness);
          // no need to update totalEnabledApprovalWeight here as the approvalWeight is always 0
        }
      }
    }
  }
};

const removeApproval = async (approval, acct, blnce, manual = true) => {
  // a user can only disapprove if it already approved a witness
  if (api.assert(approval !== null, 'you have not approved this witness')) {
    const { from, to } = approval;
    let account = acct;
    if (!acct || acct.account !== from) {
      account = await api.db.findOne('accounts', { account: from });
    }
    await api.db.remove('approvals', approval);

    let balance = blnce;
    if (!balance) {
      balance = await api.db.findOneInTable('tokens', 'balances', { account: from, symbol: GOVERNANCE_TOKEN_SYMBOL });
    }
    let approvalWeight = 0;
    if (balance && balance.stake) {
      approvalWeight = balance.stake;
    }

    if (balance && balance.delegationsIn) {
      approvalWeight = api.BigNumber(approvalWeight)
        .plus(balance.delegationsIn)
        .toFixed(GOVERNANCE_TOKEN_PRECISION);
    }

    if (manual) {
      account.approvals -= 1;
      account.approvalWeight = approvalWeight;
      account.lastApproveBlock = api.blockNumber;
      await api.db.update('accounts', account);
    }

    // update the rank of the witness that received the disapproval
    await updateWitnessRank(to, `-${approvalWeight}`);

    api.emit('witnessApprovalRemoved', { account: from, to, approvalWeight });
  }
};

actions.approve = async (payload) => {
  const { witness } = payload;
  const params = await api.db.findOne('params', {});

  if (api.assert(witness && typeof witness === 'string' && witness.length >= 3 && witness.length <= 16, 'invalid witness account')) {
    // check if witness exists
    const witnessRec = await api.db.findOne('witnesses', { account: witness });

    if (api.assert(witnessRec, 'witness does not exist')) {
      let acct = await api.db.findOne('accounts', { account: api.sender });

      if (acct === null) {
        acct = {
          account: api.sender,
          approvals: 0,
          approvalWeight: { $numberDecimal: '0' },
          lastApproveBlock: api.blockNumber,
        };

        acct = await api.db.insert('accounts', acct);
      }

      if (api.assert(acct.approvals < params.numberOfApprovalsPerAccount, `you can only approve ${params.numberOfApprovalsPerAccount} witnesses`)) {
        let approval = await api.db.findOne('approvals', { from: api.sender, to: witness });

        if (api.assert(approval === null, 'you already approved this witness')) {
          approval = {
            from: api.sender,
            to: witness,
          };
          await api.db.insert('approvals', approval);

          // update the rank of the witness that received the approval
          const balance = await api.db.findOneInTable('tokens', 'balances', { account: api.sender, symbol: GOVERNANCE_TOKEN_SYMBOL });
          let approvalWeight = 0;
          if (balance && balance.stake) {
            approvalWeight = balance.stake;
          }

          if (balance && balance.delegationsIn) {
            approvalWeight = api.BigNumber(approvalWeight)
              .plus(balance.delegationsIn)
              .toFixed(GOVERNANCE_TOKEN_PRECISION);
          }

          acct.approvals += 1;
          acct.approvalWeight = approvalWeight;
          acct.lastApproveBlock = api.blockNumber;

          await api.db.update('accounts', acct);

          await updateWitnessRank(witness, approvalWeight);

          api.emit('witnessApprovalAdded', { account: api.sender, to: witness, approvalWeight });
        }
      }
    }
  }
};

actions.disapprove = async (payload) => {
  const { witness } = payload;

  if (api.assert(witness && typeof witness === 'string' && witness.length >= 3 && witness.length <= 16, 'invalid witness account')) {
    // check if witness exists
    const witnessRec = await api.db.findOne('witnesses', { account: witness });


    if (api.assert(witnessRec, 'witness does not exist')) {
      let acct = await api.db.findOne('accounts', { account: api.sender });

      if (acct === null) {
        acct = {
          account: api.sender,
          approvals: 0,
          approvalWeight: { $numberDecimal: '0' },
          lastApproveBlock: api.blockNumber,
        };

        await api.db.insert('accounts', acct);
      }

      if (api.assert(acct.approvals > 0, 'no approvals found')) {
        const approval = await api.db.findOne('approvals', { from: acct.account, to: witness });
        const balance = await api.db.findOneInTable('tokens', 'balances', { account: api.sender, symbol: GOVERNANCE_TOKEN_SYMBOL });
        await removeApproval(approval, acct, balance, true);
      }
    }
  }
};

const expireAllUserApprovals = async (acct) => {
  const approvals = await api.db.find('approvals', { from: acct.account });
  const balance = await api.db.findOneInTable('tokens', 'balances', { account: acct.account, symbol: GOVERNANCE_TOKEN_SYMBOL });
  for (let i = 0; i < approvals.length; i += 1) {
    const approval = approvals[i];
    await removeApproval(approval, acct, balance, false);
  }
  let approvalWeight = 0;
  if (balance && balance.stake) {
    approvalWeight = balance.stake;
  }

  if (balance && balance.delegationsIn) {
    approvalWeight = api.BigNumber(approvalWeight)
      .plus(balance.delegationsIn)
      .toFixed(GOVERNANCE_TOKEN_PRECISION);
  }
  const account = acct;
  account.approvals = 0;
  account.approvalWeight = approvalWeight;
  await api.db.update('accounts', account);
  api.emit('witnessApprovalsExpired', { account: acct.account });
};

const findAndExpireApprovals = async (witnessApproveExpireBlocks) => {
  // Do up to WITNESS_MAX_ACCOUNT_EXPIRE_PER_BLOCK(currently 10) per round, starting with oldest.
  const accounts = await api.db.find('accounts', { lastApproveBlock: { $lt: api.blockNumber - witnessApproveExpireBlocks }, approvals: { $gt: 0 } }, WITNESS_MAX_ACCOUNT_EXPIRE_PER_BLOCK, 0, [{ index: 'lastApproveBlock', descending: false }]);
  for (let i = 0; i < accounts.length; i += 1) {
    await expireAllUserApprovals(accounts[i]);
  }
};

const changeCurrentWitness = async () => {
  const params = await api.db.findOne('params', {});
  const {
    currentWitness,
    totalEnabledApprovalWeight,
    lastWitnesses,
    lastBlockRound,
    round,
    maxRoundsMissedInARow,
    maxRoundPropositionWaitingPeriod,
    lastVerifiedBlockNumber,
  } = params;

  let witnessFound = false;
  // get a deterministic random weight
  const random = api.random();
  const randomWeight = api.BigNumber(totalEnabledApprovalWeight)
    .times(random)
    .toFixed(GOVERNANCE_TOKEN_PRECISION, 1);

  let offset = 0;
  let accWeight = 0;

  let witnesses = await api.db.find(
    'witnesses',
    {
      approvalWeight: {
        $gt: {
          $numberDecimal: '0',
        },
      },
      enabled: true,
    },
    100, // limit
    offset, // offset
    [
      { index: 'approvalWeight', descending: true },
    ],
  );
  // get the witnesses on schedule
  const schedules = await api.db.find('schedules', { round });
  const currentWitnessSchedule = schedules.find(s => s.witness === currentWitness);

  const previousRoundWitness = lastWitnesses.length > 1 ? lastWitnesses[lastWitnesses.length - 2] : '';

  do {
    for (let index = 0; index < witnesses.length; index += 1) {
      const witness = witnesses[index];

      accWeight = api.BigNumber(accWeight)
        .plus(witness.approvalWeight.$numberDecimal)
        .toFixed(GOVERNANCE_TOKEN_PRECISION);

      // if the witness is enabled
      // and different from the scheduled one from the previous round
      // and different from an already scheduled witness for this round
      if (witness.enabled === true
        && witness.account !== previousRoundWitness
        && schedules.find(s => s.witness === witness.account) === undefined
        && api.BigNumber(randomWeight).lte(accWeight)) {
        let witnessToChange = currentWitness;
        // if current witness verified partially, replace first witness that did not have signature
        if (currentWitnessSchedule.verifiedRound) {
          for (let index = 0; index < schedules.length; index += 1) {
            if (!schedules[index].verifiedRound) {
              witnessToChange = schedules[index].witness;
            }
          }
        }
        api.debug(`changed witness from ${witnessToChange} to ${witness.account}`);
        api.emit('witnessChanged', { removed: witnessToChange, added: witness.account });
        // remove the schedules
        const newWitnessOrder = [witness.account];
        for (let index = 0; index < schedules.length; index += 1) {
          const schedule = schedules[index];
          if (schedule.witness !== witnessToChange) {
            newWitnessOrder.push(schedule.witness);
          }
          await api.db.remove('schedules', schedule);
        }
        let blockNumber = lastVerifiedBlockNumber === 0
          ? api.blockNumber
          : lastVerifiedBlockNumber + 1;
        for (let i = 0; i < newWitnessOrder.length; i += 1) {
          const newSchedule = {
            witness: newWitnessOrder[i],
            blockNumber,
            round,
          };
          await api.db.insert('schedules', newSchedule);
          blockNumber += 1;
        }
        if (params.currentWitness !== newWitnessOrder[newWitnessOrder.length - 1]) {
          params.currentWitness = newWitnessOrder[newWitnessOrder.length - 1];
          params.lastWitnesses.push(newWitnessOrder[newWitnessOrder.length - 1]);
        }
        params.blockNumberWitnessChange = api.blockNumber
          + maxRoundPropositionWaitingPeriod;

        // update the current witness if they did not verify successfully
        if (!currentWitnessSchedule.verifiedRound) {
          const scheduledWitness = await api.db.findOne('witnesses', { account: currentWitness });
          scheduledWitness.missedRounds += 1;
          scheduledWitness.missedRoundsInARow += 1;

          // Emit that witness missed round
          api.emit('witnessMissedRound', { witness: scheduledWitness.account });

          // disable the witness if missed maxRoundsMissedInARow
          if (scheduledWitness.missedRoundsInARow >= maxRoundsMissedInARow) {
            scheduledWitness.missedRoundsInARow = 0;

            if (scheduledWitness.enabled) {
              params.totalEnabledApprovalWeight = api.BigNumber(params.totalEnabledApprovalWeight)
                .minus(scheduledWitness.approvalWeight.$numberDecimal).toFixed(GOVERNANCE_TOKEN_PRECISION);
            }

            scheduledWitness.enabled = false;

            // Emit that witness got disabled
            api.emit('witnessDisabledForMissingTooManyRoundsInARow', { witness: scheduledWitness.account });
          }
          await api.db.update('witnesses', scheduledWitness);
        }

        await api.db.update('params', params);
        witnessFound = true;
        break;
      }
    }

    if (witnessFound === false) {
      offset += 100;
      witnesses = await api.db.find(
        'witnesses',
        {
          approvalWeight: {
            $gt: {
              $numberDecimal: '0',
            },
          },
        },
        100, // limit
        offset, // offset
        [
          { index: 'approvalWeight', descending: true },
        ],
      );
    }
  } while (witnesses.length > 0 && witnessFound === false);

  if (witnessFound === false) {
    api.debug('no backup witness was found, interchanging witnesses within the current schedule');
    for (let index = 0; index < schedules.length - 1; index += 1) {
      const sched = schedules[index];
      const newWitness = sched.witness;
      if (newWitness !== previousRoundWitness) {
        api.debug(`changed current witness from ${currentWitness} to ${newWitness}`);
        schedule.witness = newWitness;
        await api.db.update('schedules', schedule);
        sched.witness = currentWitness;
        await api.db.update('schedules', sched);
        params.currentWitness = newWitness;
        params.lastWitnesses.push(newWitness);
        params.blockNumberWitnessChange = api.blockNumber
          + maxRoundPropositionWaitingPeriod;

        // update the current witness
        const scheduledWitness = await api.db.findOne('witnesses', { account: currentWitness });
        scheduledWitness.missedRounds += 1;
        scheduledWitness.missedRoundsInARow += 1;

        // Emit that witness missed round
        api.emit('witnessMissedRound', { witness: scheduledWitness.account });

        // disable the witness if missed maxRoundsMissedInARow
        if (scheduledWitness.missedRoundsInARow >= maxRoundsMissedInARow) {
          scheduledWitness.missedRoundsInARow = 0;

          if (scheduledWitness.enabled) {
            params.totalEnabledApprovalWeight = api.BigNumber(params.totalEnabledApprovalWeight)
              .minus(scheduledWitness.approvalWeight.$numberDecimal).toFixed(GOVERNANCE_TOKEN_PRECISION);
          }

          scheduledWitness.enabled = false;

          // Emit that witness got disabled
          api.emit('witnessDisabledForMissingTooManyRoundsInARow', { witness: scheduledWitness.account });
        }
        await api.db.update('params', params);

        await api.db.update('witnesses', scheduledWitness);
        api.emit('currentWitnessChanged', {});
        break;
      }
    }
  }
};

const manageWitnessesSchedule = async () => {
  if (api.sender !== 'null') return;

  const params = await api.db.findOne('params', {});
  const {
    numberOfApprovedWitnesses,
    totalEnabledApprovalWeight,
    lastVerifiedBlockNumber,
    blockNumberWitnessChange,
    lastBlockRound,
    numberOfTopWitnesses,
    numberOfWitnessSlots,
    maxRoundPropositionWaitingPeriod,
    witnessApproveExpireBlocks,
  } = params;

  // remove expired approvals before changing
  await findAndExpireApprovals(witnessApproveExpireBlocks);

  // check the current schedule
  const currentBlock = lastVerifiedBlockNumber + 1;
  let schedule = await api.db.findOne('schedules', { blockNumber: currentBlock });

  // if the current block has not been scheduled already we have to create a new schedule
  if (schedule === null) {
    api.debug('calculating new schedule');
    schedule = [];

    // there has to be enough top witnesses to start a schedule
    if (numberOfApprovedWitnesses >= numberOfWitnessSlots) {
      /*
        example:
        -> total approval weight = 10,000
        ->  approval weights:
          acct A : 1000 (from 0 to 1000)
          acct B : 900 (from 1000.00000001 to 1900)
          acct C : 800 (from 1900.00000001 to 2700)
          acct D : 700 (from 2700.00000001 to 3400)
          ...
          acct n : from ((n-1).upperBound + 0.00000001) to 10,000)

          -> total approval weight top witnesses (A-D) = 3,400
          -> pick up backup witnesses (E-n): weight range:
            from 3,400.0000001 to 10,000
      */

      // get a deterministic random weight
      const random = api.random();
      let randomWeight = null;

      let offset = 0;
      let accWeight = 0;

      let witnesses = await api.db.find(
        'witnesses',
        {
          approvalWeight: {
            $gt: {
              $numberDecimal: '0',
            },
          },
          enabled: true,
        },
        100, // limit
        offset, // offset
        [
          { index: 'approvalWeight', descending: true },
        ],
      );

      do {
        for (let index = 0; index < witnesses.length; index += 1) {
          const witness = witnesses[index];

          // calculate a random weight if not done yet
          if (schedule.length >= numberOfTopWitnesses
            && randomWeight === null) {
            randomWeight = api.BigNumber(accWeight)
              .plus(GOVERNANCE_TOKEN_MIN_VALUE)
              .plus(api.BigNumber(totalEnabledApprovalWeight)
                .minus(accWeight)
                .times(random)
                .toFixed(GOVERNANCE_TOKEN_PRECISION, 1))
              .toFixed(GOVERNANCE_TOKEN_PRECISION);
          }

          accWeight = api.BigNumber(accWeight)
            .plus(witness.approvalWeight.$numberDecimal)
            .toFixed(GOVERNANCE_TOKEN_PRECISION);

          // if the witness is enabled
          if (witness.enabled === true) {
            // if we haven't found all the top witnesses yet
            if (schedule.length < numberOfTopWitnesses
              || api.BigNumber(randomWeight).lte(accWeight)) {
              schedule.push({
                witness: witness.account,
                blockNumber: null,
              });
            }
          }

          if (schedule.length >= numberOfWitnessSlots) {
            index = witnesses.length;
          }
        }

        if (schedule.length < numberOfWitnessSlots) {
          offset += 100;
          witnesses = await api.db.find(
            'witnesses',
            {
              approvalWeight: {
                $gt: {
                  $numberDecimal: '0',
                },
              },
            },
            100, // limit
            offset, // offset
            [
              { index: 'approvalWeight', descending: true },
            ],
          );
        }
      } while (witnesses.length > 0 && schedule.length < numberOfWitnessSlots);
    }

    // if there are enough witnesses scheduled
    if (schedule.length === numberOfWitnessSlots) {
      // shuffle the witnesses
      let j; let x;
      for (let i = schedule.length - 1; i > 0; i -= 1) {
        const random = api.random();
        j = Math.floor(random * (i + 1));
        x = schedule[i];
        schedule[i] = schedule[j];
        schedule[j] = x;
      }

      // eslint-disable-next-line
      let lastWitnesses = params.lastWitnesses;
      const previousRoundWitness = lastWitnesses.length > 0 ? lastWitnesses[lastWitnesses.length - 1] : '';

      if (lastWitnesses.length >= numberOfWitnessSlots) {
        lastWitnesses = [];
      }

      // make sure the last witness of this round is not one of the last witnesses scheduled
      const lastWitness = schedule[schedule.length - 1].witness;
      if (lastWitnesses.includes(lastWitness) || previousRoundWitness === lastWitness) {
        for (let i = 0; i < schedule.length; i += 1) {
          if (!lastWitnesses.includes(schedule[i].witness)
            && schedule[i].witness !== previousRoundWitness) {
            const thisWitness = schedule[i].witness;
            schedule[i].witness = lastWitness;
            schedule[schedule.length - 1].witness = thisWitness;
            break;
          }
        }
      }

      // make sure the witness of the previous round is not the first witness of this round
      if (schedule[0].witness === previousRoundWitness) {
        const firstWitness = schedule[0].witness;
        const secondWitness = schedule[1].witness;
        schedule[0].witness = secondWitness;
        schedule[1].witness = firstWitness;
      }

      // block number attribution
      // eslint-disable-next-line prefer-destructuring
      let blockNumber = lastVerifiedBlockNumber === 0
        ? api.blockNumber
        : lastVerifiedBlockNumber + 1;
      params.round += 1;
      for (let i = 0; i < schedule.length; i += 1) {
        // the block number that the witness will have to "sign"
        schedule[i].blockNumber = blockNumber;
        schedule[i].round = params.round;
        api.debug(`scheduled witness ${schedule[i].witness} for block ${blockNumber} (round ${params.round})`);
        await api.db.insert('schedules', schedule[i]);
        blockNumber += 1;
      }

      if (lastVerifiedBlockNumber === 0) {
        params.lastVerifiedBlockNumber = api.blockNumber - 1;
      }
      const lastWitnessRoundSchedule = schedule[schedule.length - 1];
      params.lastBlockRound = lastWitnessRoundSchedule.blockNumber;
      params.currentWitness = lastWitnessRoundSchedule.witness;
      lastWitnesses.push(lastWitnessRoundSchedule.witness);
      params.lastWitnesses = lastWitnesses;
      params.blockNumberWitnessChange = api.blockNumber
        + maxRoundPropositionWaitingPeriod;
      await api.db.update('params', params);
      api.emit('newSchedule', {});
    }
  } else if (api.blockNumber >= blockNumberWitnessChange) {
    if (api.blockNumber > lastBlockRound) {
      // otherwise we change the current witness if it has not proposed the round in time
      await changeCurrentWitness();
    } else {
      params.blockNumberWitnessChange = api.blockNumber
        + maxRoundPropositionWaitingPeriod;
      await api.db.update('params', params);
      api.emit('awaitingRoundEnd', {});
    }
  }
};

actions.proposeRound = async (payload) => {
  const {
    roundHash,
    isSignedWithActiveKey,
    signatures,
  } = payload;

  const params = await api.db.findOne('params', {});
  const {
    lastVerifiedBlockNumber,
    round,
    lastBlockRound,
    currentWitness,
  } = params;

  const schedules = await api.db.find('schedules', { round }, 1000, 0, [{ index: '_id', descending: false }]);

  if (!api.assert(schedules && schedules.length > 0, 'invalid round')) {
    return;
  }

  const numberOfWitnessSlots = schedules.length;
  const { witnessSignaturesRequired } = params;

  if (!api.assert(isSignedWithActiveKey, 'you must use a transaction signed with your active key')) {
    return;
  }
  if (!api.assert(roundHash && typeof roundHash === 'string' && roundHash.length === 64, 'invalid round hash')) {
    return;
  }
  if (!api.assert(Array.isArray(signatures) && signatures.length <= numberOfWitnessSlots, 'invalid signatures')) {
    return;
  }

  let currentBlock = lastVerifiedBlockNumber + 1;
  let calculatedRoundHash = '';

  // the sender must be the current witness of the round
  if (!api.assert(api.sender === currentWitness, 'must be current witness')) {
    return;
  }

  // calculate round hash
  while (currentBlock <= lastBlockRound) {
    const block = await api.db.getBlockInfo(currentBlock);

    if (block !== null) {
      calculatedRoundHash = api.SHA256(`${calculatedRoundHash}${block.hash}`);
    } else {
      calculatedRoundHash = '';
      break;
    }

    currentBlock += 1;
  }

  if (!api.assert(calculatedRoundHash !== '' && calculatedRoundHash === roundHash, 'round hash mismatch')) {
    return;
  }

  // check the signatures
  let signaturesChecked = 0;
  const verifiedBlockInformation = [];
  const currentWitnessInfo = await api.db.findOne('witnesses', { account: currentWitness });
  const currentWitnessSignature = signatures.find(s => s[0] === currentWitness);
  for (let index = 0; index < schedules.length; index += 1) {
    const scheduledWitness = schedules[index];
    const witness = await api.db.findOne('witnesses', { account: scheduledWitness.witness });
    if (witness !== null) {
      const signature = signatures.find(s => s[0] === witness.account);
      if (signature) {
        if (api.checkSignature(
          calculatedRoundHash, signature[1], witness.signingKey, true,
        )) {
          api.debug(`witness ${witness.account} signed round ${round}`);
          signaturesChecked += 1;
          scheduledWitness.verifiedRound = true;
          await api.db.update('schedules', scheduledWitness);
        }
      }

      // the current witness will show as the witness that verified the blocks from the round
      verifiedBlockInformation.push(
        {
          blockNumber: scheduledWitness.blockNumber,
          witness: currentWitness,
          signingKey: currentWitnessInfo.signingKey,
          roundSignature: currentWitnessSignature[1],
          round,
          roundHash,
        },
      );
    }
  }

  if (!api.assert(signaturesChecked >= witnessSignaturesRequired, 'valid round hash but not enough signatures')) {
    return;
  }

  // mark blocks of the verified round as verified by the current witness
  for (let index = 0; index < verifiedBlockInformation.length; index += 1) {
    await api.verifyBlock(verifiedBlockInformation[index]);
  }

  // remove the schedules
  for (let index = 0; index < schedules.length; index += 1) {
    const schedule = schedules[index];
    await api.db.remove('schedules', schedule);
  }
  // reward the current witness
  const contractBalance = await api.db.findOneInTable('tokens', 'contractsBalances', { account: 'witnesses', symbol: UTILITY_TOKEN_SYMBOL });
  if (contractBalance
    && api.BigNumber(contractBalance.balance).gte(NB_TOKENS_NEEDED_BEFORE_REWARDING)) {
    const rewardAmount = api.BigNumber(NB_TOKENS_TO_REWARD_PER_BLOCK).multipliedBy(numberOfWitnessSlots).toFixed(UTILITY_TOKEN_PRECISION);
    await api.executeSmartContract('tokens', 'stakeFromContract', {
      to: currentWitness, symbol: UTILITY_TOKEN_SYMBOL, quantity: rewardAmount,
    });
  }

  params.currentWitness = null;
  params.lastVerifiedBlockNumber = lastBlockRound;
  await api.db.update('params', params);

  // update information for the current witness
  const witness = await api.db.findOne('witnesses', { account: currentWitness });
  witness.missedRoundsInARow = 0;
  witness.lastRoundVerified = round;
  witness.lastBlockVerified = lastBlockRound;
  witness.verifiedRounds += 1;
  await api.db.update('witnesses', witness);

  // calculate new schedule
  await manageWitnessesSchedule();
};

actions.scheduleWitnesses = async () => {
  if (api.sender !== 'null') return;

  await manageWitnessesSchedule();
};
