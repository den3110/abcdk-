// src/components/LogoAnimation.jsx
import React, { useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { Typography } from "@mui/material";
import gsap from "gsap";

const LogoWithAnimation = ({ isMobile, showBackButton }) => {
  const logoRef = useRef(null);

  useEffect(() => {
    if (!logoRef.current) return;

    // Split text into individual character spans
    const text = "PickleTour";
    const chars = text.split("").map((char) => {
      const span = document.createElement("span");
      span.textContent = char;
      span.style.display = "inline-block";
      span.style.opacity = "0";
      span.style.background = "linear-gradient(45deg, #0d6efd 30%, #0dcaf0 90%)";
      span.style.webkitBackgroundClip = "text";
      span.style.webkitTextFillColor = "transparent";
      span.style.backgroundClip = "text";
      return span;
    });

    // Clear and append character spans
    logoRef.current.innerHTML = "";
    chars.forEach((char) => logoRef.current.appendChild(char));

    // 🎭 DRAMATIC ENTRANCE ANIMATION
    const tl = gsap.timeline();

    // Stage 1: Epic 3D flip entrance with elastic bounce
    tl.fromTo(
      chars,
      {
        opacity: 0,
        y: -100,
        rotationX: -90,
        rotationZ: 180,
        scale: 0,
      },
      {
        opacity: 1,
        y: 0,
        rotationX: 0,
        rotationZ: 0,
        scale: 1,
        duration: 1.2,
        stagger: 0.08,
        ease: "elastic.out(1, 0.6)",
      }
    )
    // Stage 2: Wave bounce effect
    .to(
      chars,
      {
        y: -15,
        duration: 0.4,
        stagger: 0.05,
        ease: "power2.out",
      },
      "-=0.5"
    )
    .to(
      chars,
      {
        y: 0,
        duration: 0.5,
        stagger: 0.05,
        ease: "bounce.out",
      },
      "-=0.2"
    )
    // Stage 3: Scale pulse
    .to(
      chars,
      {
        scale: 1.15,
        duration: 0.3,
        stagger: 0.03,
        ease: "power1.inOut",
        yoyo: true,
        repeat: 1,
      },
      "-=0.3"
    );

    // 🌊 CONTINUOUS FLOATING ANIMATION (subtle)
    gsap.to(chars, {
      y: "+=3",
      duration: 2,
      stagger: 0.1,
      ease: "sine.inOut",
      yoyo: true,
      repeat: -1,
    });

    // 🎨 HOVER EFFECTS - More dramatic
    const handleMouseEnter = () => {
      gsap.to(chars, {
        y: -10,
        scale: 1.2,
        rotationY: 15,
        duration: 0.4,
        stagger: 0.03,
        ease: "back.out(2)",
      });
    };

    const handleMouseLeave = () => {
      gsap.to(chars, {
        y: 0,
        scale: 1,
        rotationY: 0,
        duration: 0.4,
        stagger: 0.03,
        ease: "power2.out",
      });
    };

    const logoEl = logoRef.current;
    logoEl.addEventListener("mouseenter", handleMouseEnter);
    logoEl.addEventListener("mouseleave", handleMouseLeave);

    // Cleanup
    return () => {
      logoEl.removeEventListener("mouseenter", handleMouseEnter);
      logoEl.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, []);

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
      <Typography
        ref={logoRef}
        variant="h5"
        sx={{
          fontWeight: 800,
          background: "linear-gradient(45deg, #0d6efd 30%, #0dcaf0 90%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          letterSpacing: "-0.5px",
          fontSize: { xs: "1.35rem", md: "1.5rem" },
          mr: isMobile && showBackButton ? 4 : 0,
          ml: isMobile && showBackButton ? 4 : 0,
          cursor: "pointer",
        }}
      >
        PickleTour
      </Typography>
    </Link>
  );
};

export default LogoWithAnimation;
