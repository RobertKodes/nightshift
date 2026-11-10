/**
 * The stylesheets every page shares, in the order the pages were designed against.
 *
 * Each page is its own JavaScript chunk now, but the styles are not split with them: many page
 * stylesheets also restyle parts that other pages show (the swap box inside a token page, the
 * lounge inside a game, the station buttons in a drawer), and several rules win only because of
 * where their file sits in this list. Loading them together, in this order, keeps every page
 * looking exactly as it did. A new page should scope its CSS under its own class and import it
 * from its own module instead of adding it here (see saas/Observatory.tsx).
 */
import "./rb/AnimatedList.css";
import "./rb/ElectricBorder.css";
import "./rb/SloshGauge.css";
import "./rb/StarBorder.css";
import "./saas/kit.css";
import "./rb/DotGrid.css";
import "./rb/SpotlightCard.css";
import "./rb/TextType.css";
import "./saas/pages/companies-station.css";
import "./saas/pages/companies.css";
import "./nx/nx.css";
import "./saas/saas.css";
import "./saas/protocol.css";
import "./saas/protocol-type.css";
import "./landing/landing.css";
import "./rb/ChromaGrid.css";
import "./rb/GlitchText.css";
import "./rb/Dither.css";
import "./rb/PixelCard.css";
import "./rb/SplitFlapText.css";
import "./saas/home3.css";
import "./saas/pages/learn.css";
import "./landing/app.css";
import "./station/station.css";
import "./station/services.css";
import "./crews/crews.css";
import "./saas/pages/tools.css";
import "./store.css";
import "./games/staked.css";
import "./stakes.css";
import "./ceo-chat.css";
import "./games/prizes.css";
import "./mswap/page.css";
import "./saas/pages/shift.css";
import "./saas/pages/swap.css";
import "./rb/StatusMark.css";
import "./saas/pages/token.css";
import "./saas/pages/frogs.css";
import "./forge.css";
import "./saas/pages/forge.css";
import "./watch.css";
import "./saas/pages/watch.css";
import "./saas/pages/stake.css";
import "./saas/pages/impact.css";
import "./saas/pages/tokenomics.css";
import "./games/live.css";
import "./games/lounge.css";
import "./saas/pages/arcade.css";
import "./pinball/arcade.css";
import "./styles.css";
import "./clarity.css";
