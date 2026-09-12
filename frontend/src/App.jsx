import { useMemo } from "react";
import { DEMO_MODE, ROOM_ID } from "./config.js";
import useRoomStatus from "./hooks/useRoomStatus.js";
import useRoomSuggestions from "./hooks/useRoomSuggestions.js";
import useAiAdvice from "./hooks/useAiAdvice.js";
import useNotifications from "./hooks/useNotifications.js";
import usePeoplePositions from "./hooks/usePeoplePositions.js";

import StatusHeader from "./components/StatusHeader.jsx";
import RoomScene from "./components/RoomScene.jsx";
import SensorGrid from "./components/SensorGrid.jsx";
import AnomalyPanel from "./components/AnomalyPanel.jsx";
import TrendBanner from "./components/TrendBanner.jsx";
import SuggestionList from "./components/SuggestionList.jsx";
import AskTwin from "./components/AskTwin.jsx";
import HistoryPanel from "./components/HistoryPanel.jsx";
import OccupancyPanel, { useCameraEvents } from "./components/OccupancyPanel.jsx";
import CameraFeed from "./components/CameraFeed.jsx";
import ToastStack from "./components/ToastStack.jsx";
import NotificationPermission from "./components/NotificationPermission.jsx";
import MobileStatus from "./components/MobileStatus.jsx";

// No router dependency: the QR-code landing view is selected by query string,
// read once at startup.
function readView() {
  const params = new URLSearchParams(window.location.search);
  return {
    view: params.get("view"),
    room: params.get("room") || ROOM_ID,
    target: params.get("target"),
  };
}

export default function App() {
  const route = useMemo(readView, []);
  const roomId = route.room;

  const feed = useRoomStatus();
  const room = feed.rooms[roomId] || null;
  const history = feed.historyByRoom[roomId] || {};
  const changedAt = feed.changedAtByRoom[roomId] || {};

  const suggestionState = useRoomSuggestions(roomId, room);

  const notifications = useNotifications({
    room: room,
    roomId: roomId,
    suggestions: suggestionState.suggestions,
    // The mobile view gets toasts only — someone who just scanned a sticker
    // should not be met with a permission prompt.
    osNotificationsAllowed: route.view !== "mobile",
  });

  const cameraEvents = useCameraEvents(!DEMO_MODE);

  if (route.view === "mobile") {
    return (
      <MobileStatus
        roomId={roomId}
        targetId={route.target}
        room={room}
        connectionState={feed.connectionState}
        lastMessageAt={feed.lastMessageAt}
        suggestions={suggestionState.suggestions}
        demoMode={DEMO_MODE}
        toasts={notifications.toasts}
        onDismissToast={notifications.dismissToast}
      />
    );
  }

  return <Dashboard
    roomId={roomId}
    feed={feed}
    room={room}
    history={history}
    changedAt={changedAt}
    suggestionState={suggestionState}
    notifications={notifications}
    cameraEvents={cameraEvents}
  />;
}

function Dashboard(props) {
  const { roomId, feed, room, history, changedAt, suggestionState } = props;
  const notifications = props.notifications;
  const advice = useAiAdvice(roomId);
  const tracked = usePeoplePositions();

  const cameraCounts = useMemo(() => {
    const counts = {};
    const byCamera = props.cameraEvents.byCamera;
    const ids = Object.keys(byCamera);
    for (let index = 0; index < ids.length; index += 1) {
      counts[ids[index]] = byCamera[ids[index]].occupancy;
    }
    return counts;
  }, [props.cameraEvents.byCamera]);

  return (
    <div className="app">
      <ToastStack
        toasts={notifications.toasts}
        onDismiss={notifications.dismissToast}
      />

      <StatusHeader
        roomId={roomId}
        room={room}
        connectionState={feed.connectionState}
        lastMessageAt={feed.lastMessageAt}
        demoMode={DEMO_MODE}
        soundEnabled={notifications.soundEnabled}
        onToggleSound={() =>
          notifications.setSoundEnabled(!notifications.soundEnabled)
        }
      />

      <NotificationPermission
        visible={notifications.bannerVisible}
        onEnable={notifications.requestPermission}
        onDismiss={notifications.dismissBanner}
      />

      <TrendBanner room={room} />

      <div className="app-main">
        <div className="app-left">
          <RoomScene
            room={room}
            cameraCounts={cameraCounts}
            people={tracked.people}
          />
          <SensorGrid room={room} history={history} changedAt={changedAt} />
          <CameraFeed />
          <OccupancyPanel
            roomId={roomId}
            room={room}
            cameraEvents={props.cameraEvents.byCamera}
            liveHistory={history}
            tracked={tracked}
          />
        </div>

        <div className="app-right">
          <AnomalyPanel room={room} />
          <SuggestionList
            suggestions={suggestionState.suggestions}
            source={suggestionState.source}
          />
          <AskTwin
            messages={advice.messages}
            isPending={advice.isPending}
            onAsk={advice.ask}
          />
        </div>
      </div>

      <HistoryPanel roomId={roomId} demoMode={DEMO_MODE} liveHistory={history} />
    </div>
  );
}
