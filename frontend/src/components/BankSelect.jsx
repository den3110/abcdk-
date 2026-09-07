/* eslint-disable react/prop-types */
import { Autocomplete, TextField, Box, Avatar } from "@mui/material";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import { BANKS, bankLogo, findBank } from "../screens/courts/banks";

/**
 * Dropdown chọn ngân hàng có ô tìm kiếm + logo.
 * value = mã ngân hàng (code). onChange(bank|null) trả { code, name, ... }.
 */
export default function BankSelect({ value, onChange, size = "small", label = "Ngân hàng" }) {
  const selected = findBank(value) || null;
  return (
    <Autocomplete
      options={BANKS}
      value={selected}
      onChange={(_e, b) => onChange(b || null)}
      isOptionEqualToValue={(o, v) => o.code === v?.code}
      getOptionLabel={(o) => o?.name || ""}
      filterOptions={(opts, { inputValue }) => {
        const q = inputValue.trim().toLowerCase();
        if (!q) return opts;
        return opts.filter(
          (o) =>
            o.name.toLowerCase().includes(q) ||
            o.subtitle.toLowerCase().includes(q) ||
            o.code.toLowerCase().includes(q),
        );
      }}
      renderOption={(props, o) => (
        <Box component="li" {...props} key={o.code} sx={{ display: "flex", gap: 1.25, alignItems: "center" }}>
          {bankLogo(o) ? (
            <Avatar src={bankLogo(o)} variant="rounded" sx={{ width: 30, height: 30, "& img": { objectFit: "contain" } }} />
          ) : (
            <Avatar variant="rounded" sx={{ width: 30, height: 30, bgcolor: "action.hover" }}><AccountBalanceIcon fontSize="small" /></Avatar>
          )}
          <Box sx={{ minWidth: 0 }}>
            <Box sx={{ fontWeight: 700, fontSize: 14 }}>{o.name}</Box>
            <Box sx={{ fontSize: 11.5, color: "text.secondary" }} noWrap>{o.subtitle}</Box>
          </Box>
        </Box>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          size={size}
          label={label}
          placeholder="Tìm tên ngân hàng…"
          InputProps={{
            ...params.InputProps,
            startAdornment: selected && bankLogo(selected) ? (
              <Avatar src={bankLogo(selected)} variant="rounded" sx={{ width: 24, height: 24, ml: 0.5, "& img": { objectFit: "contain" } }} />
            ) : null,
          }}
        />
      )}
    />
  );
}
