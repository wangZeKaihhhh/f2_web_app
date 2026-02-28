import { useNavigate } from "@tanstack/react-router";
import { clearAuthToken } from "../../lib/api";
import { Button } from "../ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";

export function DashboardTopBar() {
  const navigate = useNavigate();

  function onLogout() {
    clearAuthToken();
    void navigate({ to: "/login" });
  }

  return (
    <div className="flex w-full items-center justify-end">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              type="button"
              aria-label="退出登录"
              onClick={onLogout}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="M16 17l5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">退出登录</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
