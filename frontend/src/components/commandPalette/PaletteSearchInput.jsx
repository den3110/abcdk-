import { memo, useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import {
  CircularProgress,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
} from "@mui/material";
import { ClearRounded, SearchRounded } from "@mui/icons-material";

const PaletteSearchInput = memo(function PaletteSearchInput({
  externalValue,
  syncKey,
  inputRef,
  isBusy,
  onCommittedChange,
  placeholder,
  clearAriaLabel,
  commitDelayMs,
}) {
  const [draft, setDraft] = useState(externalValue || "");
  const isComposingRef = useRef(false);
  const skipDebouncedCommitRef = useRef(false);
  const externalValueRef = useRef(externalValue || "");

  useEffect(() => {
    externalValueRef.current = externalValue || "";
  }, [externalValue]);

  useEffect(() => {
    setDraft(externalValueRef.current);
  }, [syncKey]);

  useEffect(() => {
    if (isComposingRef.current) return undefined;
    if (skipDebouncedCommitRef.current) {
      skipDebouncedCommitRef.current = false;
      return undefined;
    }

    const timer = window.setTimeout(() => {
      onCommittedChange(draft);
    }, commitDelayMs);

    return () => window.clearTimeout(timer);
  }, [commitDelayMs, draft, onCommittedChange]);

  return (
    <TextField
      inputRef={inputRef}
      autoComplete="off"
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onCompositionStart={() => {
        isComposingRef.current = true;
      }}
      onCompositionEnd={(event) => {
        isComposingRef.current = false;
        const nextValue = event.target.value;
        skipDebouncedCommitRef.current = true;
        setDraft(nextValue);
        onCommittedChange(nextValue);
      }}
      placeholder={placeholder}
      fullWidth
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <SearchRounded color="action" />
          </InputAdornment>
        ),
        endAdornment: (
          <InputAdornment position="end">
            <Stack direction="row" spacing={0.75} alignItems="center">
              {isBusy ? <CircularProgress size={16} /> : null}
              {draft ? (
                <IconButton
                  size="small"
                  onClick={() => {
                    skipDebouncedCommitRef.current = true;
                    setDraft("");
                    onCommittedChange("");
                    inputRef?.current?.focus?.();
                  }}
                  aria-label={clearAriaLabel}
                >
                  <ClearRounded fontSize="small" />
                </IconButton>
              ) : null}
            </Stack>
          </InputAdornment>
        ),
      }}
      sx={{
        "& .MuiOutlinedInput-root": {
          borderRadius: 3,
          fontSize: "1rem",
          py: 0.25,
        },
      }}
    />
  );
});

PaletteSearchInput.propTypes = {
  externalValue: PropTypes.string,
  syncKey: PropTypes.number,
  inputRef: PropTypes.shape({ current: PropTypes.any }),
  isBusy: PropTypes.bool,
  onCommittedChange: PropTypes.func.isRequired,
  placeholder: PropTypes.string.isRequired,
  clearAriaLabel: PropTypes.string.isRequired,
  commitDelayMs: PropTypes.number,
};

PaletteSearchInput.defaultProps = {
  commitDelayMs: 140,
};

export default PaletteSearchInput;
