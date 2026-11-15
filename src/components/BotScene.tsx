// The Compass robot from the Studio design, drawn in CSS (studio.css): a floating head with
// a dark face, blinking eyes, an antenna and two soft sparkles. Decorative.
export function BotScene() {
  return (
    <div className="bot-scene" aria-hidden="true">
      <div className="bot-shadow" />
      <span className="spark-one">✦</span>
      <span className="spark-two">✧</span>
      <div className="bot">
        <div className="antenna" />
        <div className="bot-face"><i className="bot-eye" /><i className="bot-eye" /></div>
      </div>
    </div>
  );
}
