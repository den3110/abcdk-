// src/components/LogoAnimationMorph.jsx
import React, { useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { Box } from "@mui/material";
import gsap from "gsap";

const LogoAnimationMorph = ({ isMobile, showBackButton }) => {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    // Clear any existing content to prevent duplicates
    container.innerHTML = "";
    
    const text = "PickleTour";
    
    // === 1. CREATE MORPHING "P" WITH MULTIPLE SHAPES ===
    const pChar = text[0];
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "28");
    svg.setAttribute("height", "50");
    svg.style.display = "inline-block";
    svg.style.overflow = "visible";
    svg.style.marginRight = "-2px";

    // Gradient definitions - different colors for each shape
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    
    // Gradient 1: Blue (for Circle & final P)
    const gradient1 = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
    gradient1.setAttribute("id", "grad-blue");
    gradient1.setAttribute("x1", "0%");
    gradient1.setAttribute("y1", "0%");
    gradient1.setAttribute("x2", "100%");
    gradient1.setAttribute("y2", "100%");
    const stop1a = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    stop1a.setAttribute("offset", "30%");
    stop1a.setAttribute("style", "stop-color:#0d6efd;stop-opacity:1");
    const stop1b = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    stop1b.setAttribute("offset", "90%");
    stop1b.setAttribute("style", "stop-color:#0dcaf0;stop-opacity:1");
    gradient1.appendChild(stop1a);
    gradient1.appendChild(stop1b);
    defs.appendChild(gradient1);

    // Gradient 2: Purple-Pink (for Square)
    const gradient2 = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
    gradient2.setAttribute("id", "grad-purple");
    gradient2.setAttribute("x1", "0%");
    gradient2.setAttribute("y1", "0%");
    gradient2.setAttribute("x2", "100%");
    gradient2.setAttribute("y2", "100%");
    const stop2a = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    stop2a.setAttribute("offset", "30%");
    stop2a.setAttribute("style", "stop-color:#7c3aed;stop-opacity:1");
    const stop2b = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    stop2b.setAttribute("offset", "90%");
    stop2b.setAttribute("style", "stop-color:#ec4899;stop-opacity:1");
    gradient2.appendChild(stop2a);
    gradient2.appendChild(stop2b);
    defs.appendChild(gradient2);

    // Gradient 3: Green-Cyan (for Triangle)
    const gradient3 = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
    gradient3.setAttribute("id", "grad-green");
    gradient3.setAttribute("x1", "0%");
    gradient3.setAttribute("y1", "0%");
    gradient3.setAttribute("x2", "100%");
    gradient3.setAttribute("y2", "100%");
    const stop3a = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    stop3a.setAttribute("offset", "30%");
    stop3a.setAttribute("style", "stop-color:#10b981;stop-opacity:1");
    const stop3b = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    stop3b.setAttribute("offset", "90%");
    stop3b.setAttribute("style", "stop-color:#06b6d4;stop-opacity:1");
    gradient3.appendChild(stop3a);
    gradient3.appendChild(stop3b);
    defs.appendChild(gradient3);

    // Gradient 4: Orange-Yellow (for Star)
    const gradient4 = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
    gradient4.setAttribute("id", "grad-orange");
    gradient4.setAttribute("x1", "0%");
    gradient4.setAttribute("y1", "0%");
    gradient4.setAttribute("x2", "100%");
    gradient4.setAttribute("y2", "100%");
    const stop4a = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    stop4a.setAttribute("offset", "30%");
    stop4a.setAttribute("style", "stop-color:#f97316;stop-opacity:1");
    const stop4b = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    stop4b.setAttribute("offset", "90%");
    stop4b.setAttribute("style", "stop-color:#fbbf24;stop-opacity:1");
    gradient4.appendChild(stop4a);
    gradient4.appendChild(stop4b);
    defs.appendChild(gradient4);

    svg.appendChild(defs);

    // Create multiple shapes (all centered at same position)
    // All shapes centered at (14, 25) with similar visual size
    
    // Shape 1: Circle (r=10 for better sizing) - Blue gradient
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "14");
    circle.setAttribute("cy", "25");
    circle.setAttribute("r", "10");
    circle.setAttribute("fill", "url(#grad-blue)");
    circle.style.transformOrigin = "center";
    svg.appendChild(circle);

    // Shape 2: Square (20x20 centered at 14, 25) - Purple-Pink gradient
    const square = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    square.setAttribute("x", "4");   // 14 - 10
    square.setAttribute("y", "15");  // 25 - 10
    square.setAttribute("width", "20");
    square.setAttribute("height", "20");
    square.setAttribute("fill", "url(#grad-purple)");
    square.style.opacity = "0";
    square.style.transformOrigin = "center";
    svg.appendChild(square);

    // Shape 3: Triangle (equilateral, centered at 14, 25)
    const triangle = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    // Equilateral triangle with side ~17, centered at (14, 25)
    const triHeight = 15;
    const triWidth = 17;
    const triPoints = [
      [14, 25 - triHeight/2],           // top center
      [14 - triWidth/2, 25 + triHeight/2],  // bottom left
      [14 + triWidth/2, 25 + triHeight/2]   // bottom right
    ].map(p => p.join(",")).join(" ");
    triangle.setAttribute("points", triPoints);
    triangle.setAttribute("fill", "url(#grad-green)");
    triangle.style.opacity = "0";
    triangle.style.transformOrigin = "center";
    svg.appendChild(triangle);

    // Shape 4: Star (5-point star, centered at 14, 25)
    const star = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    // 5-point star with outer radius 10, inner radius 4
    const outerR = 10;
    const innerR = 4;
    const cx = 14, cy = 25;
    const starPoints = [];
    for (let i = 0; i < 10; i++) {
      const angle = (i * 36 - 90) * Math.PI / 180; // Start from top
      const r = i % 2 === 0 ? outerR : innerR;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      starPoints.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    star.setAttribute("points", starPoints.join(" "));
    star.setAttribute("fill", "url(#grad-orange)");
    star.style.opacity = "0";
    star.style.transformOrigin = "center";
    svg.appendChild(star);

    // P text (hidden initially) - solid color for consistent mobile rendering
    const pText = document.createElementNS("http://www.w3.org/2000/svg", "text");
    pText.setAttribute("x", "14");
    pText.setAttribute("y", "35");
    pText.setAttribute("text-anchor", "middle");
    pText.setAttribute("font-size", "32");
    pText.setAttribute("font-weight", "800");
    pText.setAttribute("fill", "#0d6efd"); // Solid blue - works on all devices
    pText.textContent = pChar;
    pText.style.opacity = "0";
    svg.appendChild(pText);

    container.appendChild(svg);

    // === 2. CREATE REMAINING LETTERS (hidden initially) ===
    const remainingChars = text.slice(1).split("");
    const remainingSpans = remainingChars.map((char) => {
      const span = document.createElement("span");
      span.textContent = char;
      span.style.display = "inline-block";
      span.style.opacity = "0";
      span.style.background = "linear-gradient(45deg, #0d6efd 30%, #0dcaf0 90%)";
      span.style.webkitBackgroundClip = "text";
      span.style.webkitTextFillColor = "transparent";
      span.style.backgroundClip = "text";
      span.style.fontWeight = "800";
      span.style.fontSize = isMobile ? "1.35rem" : "1.5rem";
      span.style.letterSpacing = "-0.5px";
      return span;
    });

    remainingSpans.forEach(span => container.appendChild(span));

    // === 3. MORPHING ANIMATION TIMELINE ===
    const masterTl = gsap.timeline();

    // Stage 1: Circle rotates
    masterTl.to(circle, {
      rotation: 180,
      duration: 0.4,
      ease: "power2.inOut",
    });

    // Stage 2: Circle → Square
    masterTl.to(circle, {
      opacity: 0,
      scale: 0.8,
      duration: 0.3,
      ease: "power2.in",
    }, "-=0.1");
    
    masterTl.fromTo(square, 
      { opacity: 0, scale: 0.5, rotation: -45 },
      { opacity: 1, scale: 1, rotation: 0, duration: 0.3, ease: "back.out(2)" },
      "-=0.15"
    );

    // Stage 3: Square rotates
    masterTl.to(square, {
      rotation: 90,
      duration: 0.3,
      ease: "power2.inOut",
    });

    // Stage 4: Square → Triangle
    masterTl.to(square, {
      opacity: 0,
      scale: 0.8,
      duration: 0.3,
      ease: "power2.in",
    }, "-=0.1");
    
    masterTl.fromTo(triangle,
      { opacity: 0, scale: 0.5, rotation: 120 },
      { opacity: 1, scale: 1, rotation: 0, duration: 0.3, ease: "back.out(2)" },
      "-=0.15"
    );

    // Stage 5: Triangle rotates
    masterTl.to(triangle, {
      rotation: -120,
      duration: 0.3,
      ease: "power2.inOut",
    });

    // Stage 6: Triangle → Star
    masterTl.to(triangle, {
      opacity: 0,
      scale: 0.8,
      duration: 0.3,
      ease: "power2.in",
    }, "-=0.1");
    
    masterTl.fromTo(star,
      { opacity: 0, scale: 0.3, rotation: -180 },
      { opacity: 1, scale: 1, rotation: 0, duration: 0.4, ease: "elastic.out(1, 0.6)" },
      "-=0.15"
    );

    // Stage 7: Star spins fast
    masterTl.to(star, {
      rotation: 360,
      duration: 0.5,
      ease: "power2.inOut",
    });

    // Stage 8: Star → P (final morph)
    masterTl.to(star, {
      opacity: 0,
      scale: 0,
      rotation: 720,
      duration: 0.5,
      ease: "back.in(2)",
    });

    masterTl.fromTo(pText,
      {
        opacity: 0,
        scale: 0,
        rotation: -180,
      },
      {
        opacity: 1,
        scale: 1,
        rotation: 0,
        duration: 0.8,
        ease: "elastic.out(1, 0.6)",
      },
      "-=0.4"
    );

    // P stays in place (no bounce to avoid jumping)

    // Stage 9: Remaining letters slide in from right
    masterTl.fromTo(
      remainingSpans,
      {
        opacity: 0,
        x: 50,
        scale: 0.5,
      },
      {
        opacity: 1,
        x: 0,
        scale: 1,
        duration: 0.6,
        stagger: 0.05,
        ease: "back.out(1.7)",
      },
      "+=0.2"
    );

    // Bounce wave for remaining letters
    masterTl.to(
      remainingSpans,
      {
        y: -5,
        duration: 0.2,
        stagger: 0.03,
        ease: "power2.out",
      }
    ).to(
      remainingSpans,
      {
        y: 0,
        duration: 0.3,
        stagger: 0.03,
        ease: "bounce.out",
      }
    );

    // Continuous floating for all
    setTimeout(() => {
      gsap.to([pText, ...remainingSpans], {
        y: "+=2",
        duration: 2,
        ease: "sine.inOut",
        stagger: 0.08,
        yoyo: true,
        repeat: -1,
      });
    }, 3500);

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
};

export default LogoAnimationMorph;
