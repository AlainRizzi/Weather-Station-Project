import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

// The station's own civil time, DST-aware -- matches the sensor clients
// (pi/linovision, pi/thd) and the backend's DB session timezone (see
// backend/app/db.py), so "today"/a given calendar day means the same thing
// here as it does in the stored readings and the chatbot's SQL, regardless
// of what timezone the browser itself is in.
export const STATION_TZ = "Asia/Beirut";

export default dayjs;
