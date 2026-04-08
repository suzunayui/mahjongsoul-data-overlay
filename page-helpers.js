(function () {
  if (typeof window === "undefined") {
    return;
  }

  const helperVersion = 6;
  if ((window.__mjsPageHelpersVersion || 0) >= helperVersion) {
    return;
  }

  window.__mjsPageHelpersInstalled = true;
  window.__mjsPageHelpersVersion = helperVersion;

  window.__mjsExtractMatchState = function () {
    const ensureActionHooks = () => {
      if (!window.__mjsRoundCapture) {
        window.__mjsRoundCapture = {
          lastArgs: null,
          lastCapturedAt: null
        };
      }
      if (!window.__mjsHuleCapture) {
        window.__mjsHuleCapture = {
          events: [],
          lastEvent: null
        };
      }
      if (!window.__mjsRiichiCapture) {
        window.__mjsRiichiCapture = {
          actionNames: [],
          events: [],
          lastEvent: null
        };
      }

      const actionMap = window.view?.DesktopMgr?.Inst?.actionMap;
      const wrapAction = (actionName, onCall) => {
        const entry = actionMap?.[actionName];
        if (!entry || typeof entry.method !== "function" || entry.method.__mjsWrapped) {
          return;
        }

        const originalMethod = entry.method;
        const wrappedMethod = function (...args) {
          try {
            onCall(args);
          } catch {
            // ignore
          }
          return originalMethod.apply(this, args);
        };

        Object.defineProperty(wrappedMethod, "__mjsWrapped", {
          value: true,
          enumerable: false,
          configurable: false,
          writable: false
        });

        entry.method = wrappedMethod;
      };

      wrapAction("ActionNewRound", (args) => {
        window.__mjsRoundCapture.lastArgs = args;
        window.__mjsRoundCapture.lastCapturedAt = new Date().toISOString();
      });

      const huleActions = [
        "ActionHule",
        "ActionHuleXueZhanMid",
        "ActionHuleXueZhanEnd"
      ];
      for (const actionName of huleActions) {
        wrapAction(actionName, (args) => {
          const event = {
            actionName,
            capturedAt: new Date().toISOString(),
            args
          };
          window.__mjsHuleCapture.lastEvent = event;
          window.__mjsHuleCapture.events.push(event);
          if (window.__mjsHuleCapture.events.length > 20) {
            window.__mjsHuleCapture.events.shift();
          }
        });
      }

      const riichiActionPattern = /liqi|liqibang|lizhi|riichi|reach|ready/i;
      const riichiActionNames = actionMap
        ? safeKeys(actionMap).filter((actionName) => riichiActionPattern.test(actionName))
        : [];
      window.__mjsRiichiCapture.actionNames = riichiActionNames;

      for (const actionName of riichiActionNames) {
        wrapAction(actionName, (args) => {
          const event = {
            actionName,
            capturedAt: new Date().toISOString(),
            args
          };
          window.__mjsRiichiCapture.lastEvent = event;
          window.__mjsRiichiCapture.events.push(event);
          if (window.__mjsRiichiCapture.events.length > 20) {
            window.__mjsRiichiCapture.events.shift();
          }
        });
      }
    };

    const safeKeys = (value) => {
      try {
        return Reflect.ownKeys(value)
          .filter((key) => typeof key === "string")
          .slice(0, 80);
      } catch {
        return [];
      }
    };

    ensureActionHooks();

    const summarize = (value, depth = 0) => {
      if (value == null) {
        return value;
      }
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return value;
      }
      if (depth >= 2) {
        return {
          __type: Array.isArray(value) ? "array" : typeof value,
          keys: safeKeys(value)
        };
      }
      if (Array.isArray(value)) {
        return value.slice(0, 12).map((item) => summarize(item, depth + 1));
      }
      const out = {};
      for (const key of safeKeys(value)) {
        let item;
        try {
          item = value[key];
        } catch {
          continue;
        }
        if (
          item == null ||
          typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean" ||
          Array.isArray(item) ||
          typeof item === "object"
        ) {
          out[key] = summarize(item, depth + 1);
        }
      }
      return out;
    };

    const summarizeArray = (value, limit = 4) => (
      Array.isArray(value) ? value.slice(0, limit).map((item) => summarize(item, 1)) : []
    );

    const findFirstString = (value, predicate, depth = 0, seen = new WeakSet()) => {
      if (value == null) {
        return null;
      }
      if (typeof value === "string") {
        return predicate("", value) ? value : null;
      }
      if (typeof value !== "object" || depth > 3) {
        return null;
      }
      if (seen.has(value)) {
        return null;
      }
      seen.add(value);

      for (const key of safeKeys(value)) {
        let item;
        try {
          item = value[key];
        } catch {
          continue;
        }
        if (typeof item === "string" && predicate(key, item)) {
          return item;
        }
      }

      for (const key of safeKeys(value)) {
        let item;
        try {
          item = value[key];
        } catch {
          continue;
        }
        if (item && typeof item === "object") {
          const found = findFirstString(item, predicate, depth + 1, seen);
          if (found) {
            return found;
          }
        }
      }

      return null;
    };

    const findFirstNumber = (value, predicate, depth = 0, seen = new WeakSet()) => {
      if (value == null || typeof value !== "object" || depth > 3) {
        return null;
      }
      if (seen.has(value)) {
        return null;
      }
      seen.add(value);

      for (const key of safeKeys(value)) {
        let item;
        try {
          item = value[key];
        } catch {
          continue;
        }
        if (typeof item === "number" && predicate(key, item)) {
          return item;
        }
      }

      for (const key of safeKeys(value)) {
        let item;
        try {
          item = value[key];
        } catch {
          continue;
        }
        if (item && typeof item === "object") {
          const found = findFirstNumber(item, predicate, depth + 1, seen);
          if (found != null) {
            return found;
          }
        }
      }

      return null;
    };

    const normalizeDealerSeat = (value) => {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return null;
      }
      if (value >= 0 && value <= 3) {
        return value;
      }
      if (value >= 1 && value <= 4) {
        return value - 1;
      }
      return null;
    };

    const desktopMgr = window.view?.DesktopMgr?.Inst ?? null;
    const actionMgr = desktopMgr?.action_runner ?? desktopMgr?._action_runner ?? null;
    const actionMap = desktopMgr?.actionMap ?? null;
    const players =
      desktopMgr?.players ||
      desktopMgr?._players ||
      desktopMgr?.player_views ||
      desktopMgr?.view_players ||
      null;
    const playerDatas = Array.isArray(desktopMgr?.player_datas) ? desktopMgr.player_datas : [];
    const gameEndPlayers = Array.isArray(desktopMgr?.gameEndResult?.players)
      ? desktopMgr.gameEndResult.players
      : [];
    const selfNickname = window.GameMgr?.Inst?.account_data?.nickname ?? null;
    const selfAccountId = window.GameMgr?.Inst?.account_data?.account_id ?? null;
    const otherPlayerDatas = playerDatas.filter(
      (item) =>
        item &&
        typeof item.nickname === "string" &&
        item.nickname.trim().length > 0 &&
        item.account_id !== selfAccountId
    );

    const seatLabels = ["self", "shimocha", "toimen", "kamicha"];
    const seatLabelsJp = [
      "\u81ea\u5206",
      "\u4e0b\u5bb6",
      "\u5bfe\u9762",
      "\u4e0a\u5bb6"
    ];
    const selfAbsoluteSeat = typeof desktopMgr?.seat === "number" ? desktopMgr.seat : null;
    const newRoundArgs =
      desktopMgr?.actionMap?.ActionNewRound?.args?.[0] ??
      desktopMgr?.actionMap?.ActionNewRound?.args ??
      window.__mjsRoundCapture?.lastArgs?.[0] ??
      window.__mjsRoundCapture?.lastArgs ??
      desktopMgr?.lastRoundRecord?.[0] ??
      null;
    const dealerAbsoluteSeat =
      normalizeDealerSeat(
        findFirstNumber(
          newRoundArgs ?? desktopMgr,
          (key, item) =>
            /^(ju|dealer|dealer_seat|oya|zhuang|qinjia)$/i.test(key) && Number.isInteger(item),
          0
        )
      ) ?? null;
    const latestHuleEvent = window.__mjsHuleCapture?.lastEvent ?? null;
    const latestRiichiEvent = window.__mjsRiichiCapture?.lastEvent ?? null;
    const latestHuleSummary = (() => {
      const payload = latestHuleEvent?.args?.[0]?.msg;
      const hules = Array.isArray(payload?.hules) ? payload.hules : [];
      if (hules.length === 0) {
        return null;
      }
      return {
        actionName: latestHuleEvent?.actionName ?? null,
        capturedAt: latestHuleEvent?.capturedAt ?? null,
        hules: hules.map((hule) => ({
          seat: typeof hule?.seat === "number" ? hule.seat : null,
          count: typeof hule?.count === "number" ? hule.count : null,
          fu: typeof hule?.fu === "number" ? hule.fu : null,
          zimo: Boolean(hule?.zimo),
          yiman: Boolean(hule?.yiman),
          titleId: typeof hule?.title_id === "number" ? hule.title_id : null,
          pointRong: typeof hule?.point_rong === "number" ? hule.point_rong : null,
          pointSum: typeof hule?.point_sum === "number" ? hule.point_sum : null,
          dadian: typeof hule?.dadian === "number" ? hule.dadian : null
        })),
        oldScores: Array.isArray(payload?.old_scores) ? payload.old_scores.slice(0, 4) : [],
        deltaScores: Array.isArray(payload?.delta_scores) ? payload.delta_scores.slice(0, 4) : [],
        scores: Array.isArray(payload?.scores) ? payload.scores.slice(0, 4) : []
      };
    })();
    const latestRiichiSummary = (() => {
      const payload =
        latestRiichiEvent?.args?.[0]?.msg ??
        latestRiichiEvent?.args?.[0] ??
        latestRiichiEvent?.args ??
        null;
      if (!payload) {
        return null;
      }

      const seat =
        typeof payload?.seat === "number"
          ? payload.seat
          : typeof payload?.who === "number"
            ? payload.who
            : typeof payload?.index === "number"
              ? payload.index
              : null;
      const score =
        typeof payload?.score === "number"
          ? payload.score
          : typeof payload?.point === "number"
            ? payload.point
            : null;

      return {
        actionName: latestRiichiEvent?.actionName ?? null,
        capturedAt: latestRiichiEvent?.capturedAt ?? null,
        seat,
        score,
        step:
          typeof payload?.step === "number"
            ? payload.step
            : typeof payload?.liqi === "number"
              ? payload.liqi
              : null,
        payload: summarize(payload)
      };
    })();

    const getVisualState = (value) => {
      if (!value || typeof value !== "object") {
        return {
          active: null,
          activeInHierarchy: null,
          displayedInStage: null,
          destroyed: null,
          name: null
        };
      }
      return {
        active: typeof value._active === "boolean" ? value._active : null,
        activeInHierarchy: typeof value._activeInHierarchy === "boolean" ? value._activeInHierarchy : null,
        displayedInStage: typeof value._displayedInStage === "boolean" ? value._displayedInStage : null,
        destroyed: typeof value._destroyed === "boolean" ? value._destroyed : null,
        name: typeof value.name === "string" ? value.name : null
      };
    };

    const absoluteSeatToRelativeSeat = (absoluteSeat) => {
      if (typeof absoluteSeat !== "number" || typeof selfAbsoluteSeat !== "number") {
        return null;
      }
      const normalized = (absoluteSeat - selfAbsoluteSeat + 4) % 4;
      return seatLabels[normalized] ?? null;
    };

    const absoluteSeatToRelativeSeatJp = (absoluteSeat) => {
      if (typeof absoluteSeat !== "number" || typeof selfAbsoluteSeat !== "number") {
        return null;
      }
      const normalized = (absoluteSeat - selfAbsoluteSeat + 4) % 4;
      return seatLabelsJp[normalized] ?? null;
    };

    const playerRiichiStates = Array.isArray(players)
      ? players.map((player, index) => {
          const absoluteSeat = typeof player?.seat === "number" ? player.seat : null;
          const isSelfPlayer =
            typeof absoluteSeat === "number" &&
            typeof selfAbsoluteSeat === "number" &&
            absoluteSeat === selfAbsoluteSeat;
          const transLiqiState = getVisualState(player?.trans_liqi);
          const liqibangState = getVisualState(player?.liqibang);
          const liqibangEffectsState = getVisualState(player?.liqibang_effects);
          const lastPai = player?.last_pai;
          const lastTile = player?.last_tile;
          const score =
            typeof player?.score === "number"
              ? player.score
              : findFirstNumber(player, (key) => /score|point/i.test(key));
          const duringLiqi = typeof player?.during_liqi === "boolean" ? player.during_liqi : null;
          const duringAnpaiLiqi =
            typeof player?.during_anpailiqi === "boolean" ? player.during_anpailiqi : null;
          const lastIsLiqi = typeof player?.last_is_liqi === "boolean" ? player.last_is_liqi : null;
          const afterLiqi = typeof player?.after_liqi === "boolean" ? player.after_liqi : null;
          const liqiOperation = typeof player?.liqiOperation === "number" ? player.liqiOperation : null;
          const canDiscard = typeof player?.can_discard === "boolean" ? player.can_discard : null;
          const handTileCount = Array.isArray(player?.hand) ? player.hand.length : null;
          const lastPaiCount = typeof player?.last_pai_count === "number" ? player.last_pai_count : null;
          const selfRiichiHint =
            isSelfPlayer &&
            liqiOperation === 7 &&
            canDiscard === false &&
            handTileCount === 13 &&
            (transLiqiState.activeInHierarchy === true || liqibangState.activeInHierarchy === true);
          const isRiichiLike =
            duringLiqi === true ||
            duringAnpaiLiqi === true ||
            lastIsLiqi === true ||
            afterLiqi === true ||
            transLiqiState.activeInHierarchy === true ||
            liqibangState.activeInHierarchy === true ||
            liqibangEffectsState.activeInHierarchy === true ||
            selfRiichiHint === true;

          return {
            index,
            absoluteSeat,
            relativeSeat: absoluteSeatToRelativeSeat(absoluteSeat),
            relativeSeatJp: absoluteSeatToRelativeSeatJp(absoluteSeat),
            score,
            duringLiqi,
            duringAnpaiLiqi,
            lastIsLiqi,
            afterLiqi,
            liqiOperation,
            canDiscard,
            handTileCount,
            lastPaiCount,
            transLiqiState,
            liqibangState,
            liqibangEffectsState,
            lastPaiPresent: Boolean(lastPai),
            lastTilePresent: Boolean(lastTile),
            selfRiichiHint,
            isRiichiLike
          };
        })
      : [];
    const selfRiichiState =
      playerRiichiStates.find((player) => player.absoluteSeat === selfAbsoluteSeat) ??
      playerRiichiStates[0] ??
      null;
    const activeRiichiPlayers = playerRiichiStates.filter((player) => player.isRiichiLike);

    let otherPlayerCursor = 0;
    let extractedPlayers = Array.isArray(players)
      ? players.map((player, index) => {
          const absoluteSeat = typeof player?.seat === "number" ? player.seat : null;
          const accountIdFromPlayer = findFirstNumber(player, (key) => /account_id|accountid|uid/i.test(key));
          const score =
            typeof player?.score === "number"
              ? player.score
              : findFirstNumber(player, (key) => /score|point/i.test(key));

          const playerData =
            index === 0
              ? window.GameMgr?.Inst?.account_data ?? null
              : score === 0
                ? null
                : otherPlayerDatas[otherPlayerCursor++] ?? null;

          const preferredName =
            playerData && typeof playerData.nickname === "string" && playerData.nickname.trim().length > 0
              ? playerData.nickname
              : null;

          const name =
            preferredName ||
            findFirstString(
              player,
              (key, item) =>
                /(name|nickname|account_name|player_name)/i.test(key) &&
                item.trim().length > 0 &&
                !/^man_\d+$/.test(item)
            ) ||
            (index === 0 ? window.GameMgr?.Inst?.account_data?.nickname || null : null);

          const accountId =
            (playerData && typeof playerData.account_id === "number" ? playerData.account_id : null) ??
            accountIdFromPlayer;

          return {
            index,
            seat: seatLabels[index] || "player" + index,
            seatJp: seatLabelsJp[index] || "player" + index,
            absoluteSeat,
            name: score === 0 ? null : name,
            score,
            accountId
          };
        })
      : [];

    const gameEndSummary = gameEndPlayers.map((player, index) => {
      const accountId =
        typeof player?.account_id === "number"
          ? player.account_id
          : findFirstNumber(player, (key) => /account_id|accountid|uid/i.test(key));
      const matchingPlayerData =
        playerDatas.find((item) => item && item.account_id === accountId) ??
        (accountId === selfAccountId ? window.GameMgr?.Inst?.account_data ?? null : null);
      const nickname =
        matchingPlayerData && typeof matchingPlayerData.nickname === "string"
          ? matchingPlayerData.nickname
          : null;
      const score =
        typeof player?.part_point_1 === "number"
          ? player.part_point_1
          : findFirstNumber(player, (key) => /part_point_1|score|point/i.test(key));
      const totalPoint =
        typeof player?.total_point === "number"
          ? player.total_point
          : findFirstNumber(player, (key) => /total_point/i.test(key));

      return {
        index,
        accountId,
        nickname,
        score,
        totalPoint
      };
    });

    if (!window.GameMgr?.Inst?.ingame && extractedPlayers.length > 0 && gameEndSummary.length === extractedPlayers.length) {
      const rankedSeats = [...extractedPlayers].sort((a, b) => {
        const aScore = typeof a?.score === "number" ? a.score : Number.NEGATIVE_INFINITY;
        const bScore = typeof b?.score === "number" ? b.score : Number.NEGATIVE_INFINITY;
        if (bScore !== aScore) {
          return bScore - aScore;
        }
        const aSeat = typeof a?.absoluteSeat === "number" ? a.absoluteSeat : Number.MAX_SAFE_INTEGER;
        const bSeat = typeof b?.absoluteSeat === "number" ? b.absoluteSeat : Number.MAX_SAFE_INTEGER;
        return aSeat - bSeat;
      });
      const rankedFinals = [...gameEndSummary].sort((a, b) => {
        const aScore = typeof a?.score === "number" ? a.score : Number.NEGATIVE_INFINITY;
        const bScore = typeof b?.score === "number" ? b.score : Number.NEGATIVE_INFINITY;
        return bScore - aScore;
      });

      const finalScoreMap = new Map();
      for (let i = 0; i < rankedSeats.length; i += 1) {
        const seatPlayer = rankedSeats[i];
        const finalPlayer = rankedFinals[i];
        if (seatPlayer?.seat && typeof finalPlayer?.score === "number") {
          finalScoreMap.set(seatPlayer.seat, {
            score: finalPlayer.score,
            totalPoint: typeof finalPlayer.totalPoint === "number" ? finalPlayer.totalPoint : null
          });
        }
      }

      extractedPlayers = extractedPlayers.map((player) => {
        const finalValue = finalScoreMap.get(player.seat);
        if (!finalValue) {
          return player;
        }
        return {
          ...player,
          score: finalValue.score,
          totalPoint: finalValue.totalPoint
        };
      });
    }

    return {
      createdAt: new Date().toISOString(),
      url: location.href,
      title: document.title,
      inGame: !!window.GameMgr?.Inst?.ingame,
      selfAccountId,
      selfNickname,
      selfAbsoluteSeat,
      dealerAbsoluteSeat,
      roundCaptureMeta: window.__mjsRoundCapture
        ? {
            lastCapturedAt: window.__mjsRoundCapture.lastCapturedAt ?? null
          }
        : null,
      huleCaptureMeta: window.__mjsHuleCapture
        ? {
            eventCount: Array.isArray(window.__mjsHuleCapture.events)
              ? window.__mjsHuleCapture.events.length
              : 0,
            lastCapturedAt: window.__mjsHuleCapture.lastEvent?.capturedAt ?? null
          }
        : null,
      riichiCaptureMeta: window.__mjsRiichiCapture
        ? {
            actionNames: Array.isArray(window.__mjsRiichiCapture.actionNames)
              ? window.__mjsRiichiCapture.actionNames.slice(0, 20)
              : [],
            eventCount: Array.isArray(window.__mjsRiichiCapture.events)
              ? window.__mjsRiichiCapture.events.length
              : 0,
            lastCapturedAt: window.__mjsRiichiCapture.lastEvent?.capturedAt ?? null
          }
        : null,
      newRoundSnapshot: summarize(newRoundArgs),
      latestHuleSnapshot: summarize(latestHuleEvent),
      latestHuleSummary,
      latestRiichiSnapshot: summarize(latestRiichiEvent),
      latestRiichiSummary,
      recentHuleSnapshots: summarizeArray(window.__mjsHuleCapture?.events, 3),
      recentRiichiSnapshots: summarizeArray(window.__mjsRiichiCapture?.events, 3),
      selfRiichiState,
      activeRiichiPlayers,
      playerRiichiStates,
      extractedPlayers,
      gameEndSummary
    };
  };
})();
