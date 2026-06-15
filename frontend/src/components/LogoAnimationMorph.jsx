import { memo, useLayoutEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Box } from "@mui/material";
import PropTypes from "prop-types";
import gsap from "gsap";
import MorphSVGPlugin from "gsap/MorphSVGPlugin";

gsap.registerPlugin(MorphSVGPlugin);

const SVG_NS = "http://www.w3.org/2000/svg";

const LogoAnimationMorph = memo(function LogoAnimationMorph({
  isMobile,
  showBackButton,
}) {
  const containerRef = useRef(null);

  useLayoutEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    container.innerHTML = "";

    const text = "PickleTour";
    const pChar = text[0];
    const fontSize = isMobile ? "1.35rem" : "1.5rem";
    const letterSpacing = "-0.5px";

    const canvasW = 28;
    const canvasH = 50;
    const dpr = window.devicePixelRatio || 1;
    const ickleTourWidth = isMobile ? 75 : 90;
    let remainingTextWidth = ickleTourWidth;

    const canvas = document.createElement("canvas");
    canvas.width = canvasW * dpr;
    canvas.height = canvasH * dpr;
    canvas.style.width = `${canvasW}px`;
    canvas.style.height = `${canvasH}px`;
    canvas.style.display = "inline-block";
    canvas.style.overflow = "visible";
    canvas.style.marginRight = "-2px";
    canvas.style.transformOrigin = "center";
    canvas.style.willChange = "transform, opacity";

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const gradient = ctx.createLinearGradient(0, 0, canvasW, canvasH);
    gradient.addColorStop(0.3, "#0d6efd");
    gradient.addColorStop(0.9, "#0dcaf0");

    const circlePath = "M 14 15 A 10 10 0 1 1 14 35 A 10 10 0 1 1 14 15 Z";
    const squarePath = "M 4 15 L 24 15 L 24 35 L 4 35 Z";
    const trianglePath = "M 14 14 L 4 33 L 24 33 Z";
    const starPath =
      "M 14 15 L 16.35 21.76 L 23.51 21.91 L 17.8 26.23 L 19.87 33.09 L 14 29.05 L 8.13 33.09 L 10.2 26.23 L 4.49 21.91 L 11.65 21.76 Z";

    const hiddenSvg = document.createElementNS(SVG_NS, "svg");
    hiddenSvg.setAttribute("width", String(canvasW));
    hiddenSvg.setAttribute("height", String(canvasH));
    hiddenSvg.style.position = "absolute";
    hiddenSvg.style.left = "-9999px";
    hiddenSvg.style.top = "-9999px";
    hiddenSvg.style.opacity = "0";
    hiddenSvg.style.pointerEvents = "none";

    const morphPath = document.createElementNS(SVG_NS, "path");
    morphPath.setAttribute("d", circlePath);
    hiddenSvg.appendChild(morphPath);
    document.body.appendChild(hiddenSvg);

    const drawMorphPath = () => {
      const d = morphPath.getAttribute("d");
      if (!d) return;
      ctx.clearRect(0, 0, canvasW, canvasH);
      ctx.fillStyle = gradient;
      ctx.fill(new Path2D(d));
    };

    drawMorphPath();

    const logoWrapper = document.createElement("div");
    logoWrapper.style.display = "inline-flex";
    logoWrapper.style.alignItems = "center";
    logoWrapper.style.position = "relative";

    if (document.body) {
      const measureSpan = document.createElement("span");
      measureSpan.textContent = text;
      measureSpan.style.position = "absolute";
      measureSpan.style.visibility = "hidden";
      measureSpan.style.whiteSpace = "nowrap";
      measureSpan.style.fontSize = fontSize;
      measureSpan.style.fontWeight = "800";
      measureSpan.style.letterSpacing = letterSpacing;
      measureSpan.style.fontFamily =
        window.getComputedStyle(container).fontFamily || "inherit";
      document.body.appendChild(measureSpan);
      const fullWidth =
        Math.ceil(measureSpan.getBoundingClientRect().width) + 6;
      measureSpan.textContent = text.slice(1);
      remainingTextWidth =
        Math.ceil(measureSpan.getBoundingClientRect().width) + 2;
      measureSpan.remove();
      logoWrapper.style.minWidth = `${fullWidth}px`;
    }
    logoWrapper.style.willChange = "transform";
    logoWrapper.style.backfaceVisibility = "hidden";

    const pWrapper = document.createElement("div");
    pWrapper.style.display = "inline-flex";
    pWrapper.style.alignItems = "center";
    pWrapper.style.position = "relative";
    pWrapper.style.willChange = "transform";

    const pSpan = document.createElement("span");
    pSpan.textContent = pChar;
    pSpan.style.display = "inline-block";
    pSpan.style.opacity = "0";
    pSpan.style.background = "linear-gradient(45deg, #0d6efd 30%, #0dcaf0 90%)";
    pSpan.style.webkitBackgroundClip = "text";
    pSpan.style.webkitTextFillColor = "transparent";
    pSpan.style.backgroundClip = "text";
    pSpan.style.fontWeight = "800";
    pSpan.style.fontSize = fontSize;
    pSpan.style.letterSpacing = letterSpacing;
    pSpan.style.marginLeft = "-28px";
    pSpan.style.position = "relative";
    pSpan.style.zIndex = "10";
    pSpan.style.willChange = "transform, opacity";
    pSpan.style.backfaceVisibility = "hidden";

    pWrapper.appendChild(canvas);
    pWrapper.appendChild(pSpan);

    const lettersWrapper = document.createElement("span");
    lettersWrapper.style.display = "inline-block";
    lettersWrapper.style.whiteSpace = "nowrap";
    lettersWrapper.style.opacity = "0";
    lettersWrapper.style.width = `${remainingTextWidth}px`;
    lettersWrapper.style.overflow = "hidden";
    lettersWrapper.style.clipPath = "inset(0 100% 0 0)";
    lettersWrapper.style.webkitClipPath = "inset(0 100% 0 0)";
    lettersWrapper.style.transformOrigin = "left center";
    lettersWrapper.style.willChange = "clip-path, opacity";

    const remainingSpans = text
      .slice(1)
      .split("")
      .map((char) => {
        const span = document.createElement("span");
        span.textContent = char;
        span.style.display = "inline-block";
        span.style.background =
          "linear-gradient(45deg, #0d6efd 30%, #0dcaf0 90%)";
        span.style.webkitBackgroundClip = "text";
        span.style.webkitTextFillColor = "transparent";
        span.style.backgroundClip = "text";
        span.style.fontWeight = "800";
        span.style.fontSize = fontSize;
        span.style.letterSpacing = letterSpacing;
        span.style.willChange = "transform, opacity";
        span.style.backfaceVisibility = "hidden";
        return span;
      });

    remainingSpans.forEach((span) => lettersWrapper.appendChild(span));

    logoWrapper.appendChild(pWrapper);
    logoWrapper.appendChild(lettersWrapper);
    container.appendChild(logoWrapper);

    gsap.set(logoWrapper, { x: ickleTourWidth / 2, force3D: true });

    const masterTl = gsap.timeline();
    let floatingTween = null;

    const addMorphStep = (shape, duration) => {
      masterTl.to(morphPath, {
        duration,
        ease: "none",
        morphSVG: {
          shape,
          shapeIndex: 0,
          map: "size",
        },
        onStart: drawMorphPath,
        onUpdate: drawMorphPath,
      });
    };

    addMorphStep(squarePath, 0.58);
    addMorphStep(trianglePath, 0.58);
    addMorphStep(starPath, 0.58);

    masterTl.to(canvas, {
      opacity: 0,
      scale: 0.6,
      duration: 0.3,
      ease: "power2.in",
      force3D: true,
      onComplete: () => {
        canvas.style.display = "none";
      },
    });

    masterTl.fromTo(
      pSpan,
      {
        opacity: 0,
        scale: 0,
        rotation: 0,
      },
      {
        opacity: 1,
        scale: 1,
        rotation: 0,
        duration: 0.8,
        ease: "elastic.out(1, 0.6)",
        force3D: true,
      },
      "-=0.4",
    );

    masterTl.to({}, { duration: 0.35 });

    masterTl.to(logoWrapper, {
      x: 0,
      duration: 0.6,
      ease: "power2.out",
      force3D: true,
    });

    masterTl.to(
      lettersWrapper,
      {
        clipPath: "inset(0 0% 0 0)",
        webkitClipPath: "inset(0 0% 0 0)",
        opacity: 1,
        duration: 0.5,
        ease: "power2.out",
      },
      "-=0.5",
    );

    masterTl.fromTo(
      remainingSpans,
      {
        x: 20,
        opacity: 0,
      },
      {
        x: 0,
        opacity: 1,
        duration: 0.35,
        stagger: 0.03,
        ease: "back.out(1.5)",
        force3D: true,
      },
      "-=0.4",
    );

    masterTl
      .to(remainingSpans, {
        y: -5,
        duration: 0.2,
        stagger: 0.03,
        ease: "power2.out",
        force3D: true,
      })
      .to(remainingSpans, {
        y: 0,
        duration: 0.3,
        stagger: 0.03,
        ease: "bounce.out",
        force3D: true,
      });

    masterTl.call(() => {
      if (floatingTween) floatingTween.kill();
      floatingTween = gsap.to([pSpan, ...remainingSpans], {
        y: "+=2",
        duration: 2,
        ease: "sine.inOut",
        stagger: 0.08,
        yoyo: true,
        repeat: -1,
        force3D: true,
      });
    });

    const handleVisibilityChange = () => {
      if (document.hidden) {
        masterTl.pause();
        if (floatingTween) floatingTween.pause();
        return;
      }

      masterTl.resume();
      if (floatingTween) floatingTween.resume();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      masterTl.kill();
      if (floatingTween) floatingTween.kill();
      gsap.killTweensOf([
        logoWrapper,
        pSpan,
        canvas,
        ...remainingSpans,
        morphPath,
      ]);
      if (hiddenSvg.parentNode) hiddenSvg.parentNode.removeChild(hiddenSvg);
      container.innerHTML = "";
    };
  }, [isMobile]);

  return (
    <Link
      to="/"
      style={{
        textDecoration: "none",
        flexGrow: isMobile ? 1 : 0,
        textAlign: isMobile ? "center" : "left",
        display: "block",
      }}
      onClick={() => window.scrollTo(0, 0)}
    >
      <Box
        ref={containerRef}
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: isMobile ? "center" : "flex-start",
          height: "50px",
          mr: isMobile && showBackButton ? 4 : 0,
          ml: isMobile && showBackButton ? 4 : 0,
          cursor: "pointer",
          "&:hover text": {
            transform: "scale(1.1) translateY(-5px)",
            transition: "transform 0.3s ease",
          },
        }}
      />
    </Link>
  );
});

LogoAnimationMorph.propTypes = {
  isMobile: PropTypes.bool,
  showBackButton: PropTypes.bool,
};

export default LogoAnimationMorph;
