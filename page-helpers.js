(function () {
  if (typeof window === "undefined") {
    return;
  }

  if (window.__mjsPageHelpersInstalled) {
    return;
  }

  window.__mjsPageHelpersInstalled = true;

  window.__mjsExtractMatchState = function () {
    const ensureRoundHook = () => {
      if (!window.__mjsRoundCapture) {
        window.__mjsRoundCapture = {
          lastArgs: null,
          lastCapturedAt: null
        };
      }

      const actionMap = window.view?.DesktopMgr?.Inst?.actionMap;
      const entry = actionMap?.ActionNewRound;
      if (!entry || typeof entry.method !== "function" || entry.method.__mjsWrapped) {
        return;
      }

      const originalMethod = entry.method;
      const wrappedMethod = function (...args) {
        try {
          window.__mjsRoundCapture.lastArgs = args;
          window.__mjsRoundCapture.lastCapturedAt = new Date().toISOString();
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

    ensureRoundHook();

    const safeKeys = (value) => {
      try {
        return Reflect.ownKeys(value)
          .filter((key) => typeof key === "string")
          .slice(0, 80);
      } catch {
        return [];
      }
    };

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

    const playerSummaries = Array.isArray(players)
      ? players.map((player, index) => ({
          index,
          keys: safeKeys(player),
          snapshot: summarize(player)
        }))
      : [];

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

    const scoreCandidates = [];
    const seen = new WeakSet();
    const walk = (value, path, depth = 0) => {
      if (!value || typeof value !== "object" || depth > 3 || seen.has(value)) {
        return;
      }
      seen.add(value);

      for (const key of safeKeys(value)) {
        let item;
        try {
          item = value[key];
        } catch {
          continue;
        }

        if (/score|point|gold|liqibang|benchang|total_point|all_point/i.test(key)) {
          scoreCandidates.push({
            path: path + "." + key,
            value: summarize(item)
          });
        }

        if (item && typeof item === "object") {
          walk(item, path + "." + key, depth + 1);
        }
      }
    };

    walk(desktopMgr, "view.DesktopMgr.Inst");

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
      newRoundSnapshot: summarize(newRoundArgs),
      playerDataSummaries: playerDatas.map((item, index) => ({
        index,
        snapshot: summarize(item)
      })),
      extractedPlayers,
      gameEndSummary,
      desktopMgrKeys: safeKeys(desktopMgr),
      actionMgrKeys: safeKeys(actionMgr),
      playerSummaries,
      scoreCandidates: scoreCandidates.slice(0, 200),
      desktopSnapshot: summarize(desktopMgr),
      actionSnapshot: summarize(actionMgr)
    };
  };
})();
